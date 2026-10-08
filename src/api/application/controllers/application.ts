import { factories } from '@strapi/strapi';
import type { JSONValue } from '@strapi/types/dist/utils/json';
import { requireAuthenticatedUser } from '../../../helpers/inject-owner';

type AuthUser = { id?: number; email?: string };

interface ChatMessageJson {
  id: string;
  text: string;
  from: string;
  time: string;
  isSystem?: boolean;
  senderName?: string;
}

function asJsonMessages(messages: ChatMessageJson[]): JSONValue {
  return messages as unknown as JSONValue;
}

function isAdminUser(user: AuthUser | undefined): boolean {
  const email = user?.email?.toLowerCase() ?? '';
  return email.includes('admin');
}

function welcomeMessage(vacancyTitle: string): ChatMessageJson {
  return {
    id: `m-${Date.now()}`,
    text: `Здравствуйте! Заявка на смену «${vacancyTitle}» получена. Проверяем детали и свяжемся с вами в течение 10 минут.`,
    from: 'employer',
    time: 'Только что',
    isSystem: true,
  };
}

function statusLabelFor(status: string): string {
  if (status === 'active') return 'Активен';
  if (status === 'rejected' || status === 'cancelled') return 'Отказ';
  if (status === 'reviewing') return 'На рассмотрении';
  if (status === 'completed') return 'Завершён';
  return 'Ожидает';
}

export default factories.createCoreController('api::application.application', ({ strapi }) => ({
  async find(ctx) {
    requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const isAdmin = isAdminUser(user);

    const filters = isAdmin ? {} : { owner: { id: user.id } };

    const data = await strapi.documents('api::application.application').findMany({
      filters,
      populate: ctx.query.populate ?? '*',
    });

    return { data, meta: { pagination: { total: data.length } } };
  },

  async findOne(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;

    const data = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: ctx.query.populate ?? '*',
    });

    const owner = data as { owner?: { id?: number } } | null;
    const ownerId = owner?.owner?.id;
    if (!data || (ownerId !== userId && !isAdminUser(user))) {
      return ctx.notFound('Application not found');
    }

    return { data };
  },

  async create(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const body = { ...(ctx.request.body?.data ?? {}) };

    const vacancyRef = body.vacancy;
    const vacancyDocumentId =
      typeof vacancyRef === 'string'
        ? vacancyRef
        : typeof vacancyRef === 'object' && vacancyRef !== null
          ? String((vacancyRef as { documentId?: string; id?: string }).documentId ?? (vacancyRef as { id?: string }).id ?? '')
          : '';

    if (!vacancyDocumentId) {
      return ctx.badRequest('vacancy is required');
    }

    const vacancy = await strapi.documents('api::vacancy.vacancy').findOne({
      documentId: vacancyDocumentId,
      status: 'published',
    });

    if (!vacancy) {
      return ctx.notFound('Vacancy not found');
    }

    const existing = await strapi.documents('api::application.application').findMany({
      filters: {
        owner: { id: userId },
        vacancy: { documentId: vacancyDocumentId },
      },
      limit: 1,
    });

    if (existing.length > 0) {
      return ctx.conflict('Application already exists for this vacancy');
    }

    const v = vacancy as Record<string, unknown>;

    const payload = {
      vacancy: vacancyDocumentId,
      owner: userId,
      role: body.role ?? v.title ?? 'Смена',
      company: body.company ?? v.company,
      location: body.location ?? v.locationName,
      lat: body.lat ?? v.lat,
      lng: body.lng ?? v.lng,
      salary: body.salary ?? v.salary,
      scheduleDate: body.scheduleDate ?? 'Сегодня с 10:00',
      duration: body.duration ?? '8 часов',
      walkTime: body.walkTime ?? '~10 минут пешком',
      description: body.description ?? v.description,
      color: body.color ?? v.color,
      appliedDate: body.appliedDate ?? 'Сегодня',
      progressStep: 1,
      status: 'pending' as const,
      statusLabel: 'Ожидает',
      requirementsNotes: Array.isArray(body.requirementsNotes)
        ? body.requirementsNotes
        : Array.isArray(v.requirements)
          ? v.requirements
          : [],
      messages: asJsonMessages([welcomeMessage(String(v.title ?? 'смену'))]),
    };

    const data = await strapi.documents('api::application.application').create({
      data: payload,
    });

    return { data };
  },

  async update(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: ['owner'],
    });

    const owner = existing as { owner?: { id?: number } } | null;
    const ownerId = owner?.owner?.id;
    if (!existing || (ownerId !== userId && !isAdminUser(user))) {
      return ctx.notFound('Application not found');
    }

    const data = await strapi.documents('api::application.application').update({
      documentId,
      data: ctx.request.body?.data ?? {},
    });

    return { data };
  },

  async updateStatus(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;
    const { status, step, rejectionReason } = ctx.request.body ?? {};

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: ['owner'],
    });

    const owner = existing as { owner?: { id?: number } } | null;
    const ownerId = owner?.owner?.id;
    if (!existing || (ownerId !== userId && !isAdminUser(user))) {
      return ctx.notFound('Application not found');
    }

    const patch: Record<string, unknown> = {};
    if (status !== undefined) {
      patch.status = status;
      patch.statusLabel = statusLabelFor(String(status));
    }
    if (step !== undefined) {
      patch.progressStep = step;
    }
    if (rejectionReason !== undefined) {
      patch.rejectionReason = rejectionReason;
    }

    const data = await strapi.documents('api::application.application').update({
      documentId,
      data: patch,
    });

    return { data };
  },

  async addMessage(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;
    const { text, senderRole, senderName } = ctx.request.body ?? {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return ctx.badRequest('text is required');
    }

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: ['owner'],
    });

    const owner = existing as { owner?: { id?: number }; messages?: unknown[] } | null;
    const ownerId = owner?.owner?.id;
    if (!existing || (ownerId !== userId && !isAdminUser(user))) {
      return ctx.notFound('Application not found');
    }

    const from = senderRole === 'admin' || senderRole === 'employer' ? 'employer' : 'user';
    const message: ChatMessageJson = {
      id: `m-${Date.now()}`,
      text: text.trim(),
      from,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      isSystem: false,
      senderName: senderName ?? (from === 'employer' ? 'Координатор Halty (АДМИН)' : 'Вы'),
    };

    const prevMessages = (Array.isArray(owner?.messages) ? owner.messages : []) as ChatMessageJson[];
    const data = await strapi.documents('api::application.application').update({
      documentId,
      data: {
        messages: asJsonMessages([...prevMessages, message]),
      },
    });

    return { data: message, application: data };
  },
}));
