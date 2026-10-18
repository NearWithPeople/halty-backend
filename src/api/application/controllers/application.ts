import { factories } from '@strapi/strapi';
import type { JSONValue } from '@strapi/types/dist/utils/json';
import { requireAuthenticatedUser } from '../../../helpers/inject-owner';

type AuthUser = {
  id?: number;
  email?: string;
  accountRole?: 'user' | 'employer' | 'admin';
  companyName?: string;
};

type AppDoc = {
  owner?: { id?: number };
  company?: string;
  vacancy?: { documentId?: string; owner?: { id?: number } } | string | null;
  vacancyDocumentId?: string;
  messages?: unknown[];
  applicationStatus?: string;
};

function accountRoleOf(user: AuthUser | undefined): 'user' | 'employer' | 'admin' {
  if (user?.accountRole === 'employer' || user?.accountRole === 'admin' || user?.accountRole === 'user') {
    return user.accountRole;
  }
  return 'user';
}

function canAccessApplication(app: AppDoc, user: AuthUser, userId: number): boolean {
  if (accountRoleOf(user) === 'admin') return true;
  if (app.owner?.id === userId) return true;
  if (accountRoleOf(user) !== 'employer') return false;
  const vacancy = app.vacancy;
  const vacancyOwnerId = vacancy && typeof vacancy === 'object' ? vacancy.owner?.id : undefined;
  if (vacancyOwnerId === userId) return true;
  const company = user.companyName?.trim().toLowerCase();
  return Boolean(company && app.company && app.company.toLowerCase() === company);
}

const APP_POPULATE = {
  owner: true,
  vacancy: { populate: { owner: true } },
} as const;

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

type ApplicationDoc = Record<string, unknown>;

/**
 * Map a raw `application` document to the public API shape consumed by the
 * frontend. Renames internal fields (`applicationStatus` → `status`,
 * `vacancyDocumentId` → `vacancyId`), flattens the vacancy relation into its
 * `documentId` and exposes the vacancy owner as `createdByUserId`. Sensitive
 * owner fields (`password`, reset/confirmation tokens) are stripped.
 *
 * @param doc - Raw application document (with populated `owner`/`vacancy`), or `null`.
 * @returns The sanitized application document, or `null` when `doc` is null.
 */
function toApiApplication(doc: ApplicationDoc | null): ApplicationDoc | null {
  if (!doc) return doc;
  const { applicationStatus, vacancyDocumentId, vacancy, ...rest } = doc as ApplicationDoc & {
    vacancy?: AppDoc['vacancy'];
  };
  const fromRelation =
    vacancy && typeof vacancy === 'object' ? vacancy.documentId : typeof vacancy === 'string' ? vacancy : undefined;
  const safeVacancy =
    vacancy && typeof vacancy === 'object'
      ? (() => {
          const { owner: vacancyOwner, ...vacancyRest } = vacancy as Record<string, unknown> & {
            owner?: { id?: number };
          };
          return {
            ...vacancyRest,
            createdByUserId: vacancyOwner?.id != null ? String(vacancyOwner.id) : undefined,
          };
        })()
      : vacancy;
  const owner = rest.owner as { password?: string; resetPasswordToken?: string; confirmationToken?: string } | undefined;
  const safeOwner =
    owner && typeof owner === 'object'
      ? (() => {
          const { password: _password, resetPasswordToken: _reset, confirmationToken: _token, ...ownerRest } = owner;
          return ownerRest;
        })()
      : owner;
  return {
    ...rest,
    owner: safeOwner,
    vacancy: safeVacancy,
    status: applicationStatus ?? 'pending',
    vacancyId: vacancyDocumentId ?? fromRelation,
  };
}

function toApiApplications(docs: ApplicationDoc[]): ApplicationDoc[] {
  return docs.map((doc) => toApiApplication(doc) as ApplicationDoc);
}

function toInternalData(data: ApplicationDoc): ApplicationDoc {
  const { status, step, ...rest } = data;
  const internal = { ...rest };
  if (status !== undefined) internal.applicationStatus = status;
  if (step !== undefined) internal.progressStep = step;
  return internal;
}

export default factories.createCoreController('api::application.application', ({ strapi }) => ({
  async find(ctx) {
    requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const role = accountRoleOf(user);
    const company = user.companyName?.trim();
    const filters =
      role === 'admin'
        ? {}
        : role === 'employer'
          ? {
              $or: [
                { vacancy: { owner: { id: user.id } } },
                ...(company ? [{ company: { $eq: company } }] : []),
              ],
            }
          : { owner: { id: user.id } };

    const data = await strapi.documents('api::application.application').findMany({
      filters,
      populate: APP_POPULATE,
    });

    const applications = toApiApplications(data as unknown as ApplicationDoc[]);

    return { data: applications, meta: { pagination: { total: applications.length } } };
  },

  async findOne(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;

    const data = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: APP_POPULATE,
    });

    if (!data || !canAccessApplication(data as AppDoc, user, userId)) {
      return ctx.notFound('Application not found');
    }

    return { data: toApiApplication(data as unknown as ApplicationDoc) };
  },

  async create(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    if (accountRoleOf(user) !== 'user') {
      return ctx.forbidden('Отклик может отправить исполнитель');
    }
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

    if (!vacancy || (vacancy as { moderationStatus?: string }).moderationStatus === 'pending' || (vacancy as { moderationStatus?: string }).moderationStatus === 'rejected') {
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
      applicationStatus: 'pending' as const,
      statusLabel: 'Ожидает',
      requirementsNotes: Array.isArray(body.requirementsNotes)
        ? body.requirementsNotes
        : Array.isArray(v.requirements)
          ? v.requirements
          : [],
      vacancyDocumentId,
      messages: asJsonMessages([welcomeMessage(String(v.title ?? 'смену'))]),
    };

    const created = await strapi.documents('api::application.application').create({
      data: payload,
    });
    const data = await strapi.documents('api::application.application').findOne({
      documentId: created.documentId,
      populate: APP_POPULATE,
    });

    return { data: toApiApplication(data as unknown as ApplicationDoc) };
  },

  async update(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: APP_POPULATE,
    });

    if (!existing || !canAccessApplication(existing as AppDoc, user, userId)) {
      return ctx.notFound('Application not found');
    }

    const data = await strapi.documents('api::application.application').update({
      documentId,
      data: toInternalData(ctx.request.body?.data ?? {}),
    });

    return { data: toApiApplication(data as unknown as ApplicationDoc) };
  },

  async updateStatus(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;
    const { status, step, rejectionReason } = ctx.request.body ?? {};

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: APP_POPULATE,
    });

    if (!existing || !canAccessApplication(existing as AppDoc, user, userId)) {
      return ctx.notFound('Application not found');
    }
    if (accountRoleOf(user) === 'user' && status !== undefined && status !== 'cancelled' && status !== 'pending') {
      return ctx.forbidden('Исполнитель может только отменить отклик');
    }

    const patch: Record<string, unknown> = {};
    if (status !== undefined) {
      patch.applicationStatus = status;
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

    return { data: toApiApplication(data as unknown as ApplicationDoc) };
  },

  async addMessage(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AuthUser;
    const documentId = ctx.params.id;
    const { text, senderRole, senderName, id: clientMessageId } = ctx.request.body ?? {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return ctx.badRequest('text is required');
    }

    const existing = await strapi.documents('api::application.application').findOne({
      documentId,
      populate: APP_POPULATE,
    });

    if (!existing || !canAccessApplication(existing as AppDoc, user, userId)) {
      return ctx.notFound('Application not found');
    }

    const from = senderRole === 'admin' || senderRole === 'employer' ? 'employer' : 'user';
    const message: ChatMessageJson = {
      id: typeof clientMessageId === 'string' && clientMessageId.startsWith('msg-') ? clientMessageId : `m-${Date.now()}`,
      text: text.trim(),
      from,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      isSystem: false,
      senderName: senderName ?? (from === 'employer' ? 'Координатор Halty (АДМИН)' : 'Вы'),
    };

    const prevMessages = (Array.isArray((existing as AppDoc).messages) ? (existing as AppDoc).messages : []) as ChatMessageJson[];
    const data = await strapi.documents('api::application.application').update({
      documentId,
      data: {
        messages: asJsonMessages([...prevMessages, message]),
      },
    });

    return { data: message, application: toApiApplication(data as unknown as ApplicationDoc) };
  },
}));
