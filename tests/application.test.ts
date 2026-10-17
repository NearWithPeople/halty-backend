import { toApiApplication } from '../src/api/application/controllers/application';

describe('toApiApplication', () => {
  it('returns null for a null input', () => {
    expect(toApiApplication(null)).toBeNull();
  });

  it('maps internal DB fields to the API contract', () => {
    const result = toApiApplication({
      documentId: 'app-1',
      applicationStatus: 'active',
      vacancyDocumentId: 'vac-1',
      vacancy: 'vac-1',
    });

    expect(result).toMatchObject({
      documentId: 'app-1',
      status: 'active',
      vacancyId: 'vac-1',
    });
    expect(result).not.toHaveProperty('applicationStatus');
    expect(result).not.toHaveProperty('vacancyDocumentId');
  });

  it('defaults the status to pending when applicationStatus is missing', () => {
    const result = toApiApplication({ documentId: 'app-2' });

    expect(result).toMatchObject({ status: 'pending' });
  });

  it('serializes the vacancy relation, dropping owner and exposing createdByUserId', () => {
    const result = toApiApplication({
      documentId: 'app-3',
      vacancy: { documentId: 'vac-9', title: 'Loader', owner: { id: 42, email: 'boss@example.com' } },
    });

    expect(result!.vacancy).toEqual({
      documentId: 'vac-9',
      title: 'Loader',
      createdByUserId: '42',
    });
  });

  it('falls back to the relation documentId when vacancyDocumentId is absent', () => {
    const result = toApiApplication({
      documentId: 'app-4',
      vacancy: { documentId: 'vac-77' },
    });

    expect(result!.vacancyId).toBe('vac-77');
  });

  it('omits createdByUserId when the vacancy has no owner', () => {
    const result = toApiApplication({
      documentId: 'app-6',
      vacancy: { documentId: 'vac-1', title: 'Courier' },
    });

    expect(result!.vacancy).toEqual({
      documentId: 'vac-1',
      title: 'Courier',
      createdByUserId: undefined,
    });
  });

  it('strips sensitive fields from the owner relation', () => {
    const result = toApiApplication({
      documentId: 'app-5',
      owner: {
        id: 1,
        username: 'worker',
        password: 'secret',
        resetPasswordToken: 'reset-token',
        confirmationToken: 'confirm-token',
      },
    });

    expect(result!.owner).toEqual({ id: 1, username: 'worker' });
  });
});
