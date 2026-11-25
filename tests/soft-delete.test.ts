import { SOFT_DELETE_MODELS, softDeleteOperation } from '../src/database/soft-delete';

describe('soft delete only applies to models that have deletedAt', () => {
  it('turns delete into update and deleteMany into updateMany for soft-deletable models', () => {
    expect(softDeleteOperation('delete', 'Rally')).toBe('update');
    expect(softDeleteOperation('deleteMany', 'Participant')).toBe('updateMany');
    expect(softDeleteOperation('delete', 'TeamMember')).toBe('update');
  });

  it('really deletes rows of models without deletedAt (e.g. rider-rally links)', () => {
    expect(softDeleteOperation('deleteMany', 'ParticipantRally')).toBeNull();
    expect(softDeleteOperation('delete', 'UserRole')).toBeNull();
    expect(softDeleteOperation('delete', 'RallyAcceptance')).toBeNull();
  });

  it('leaves every other operation alone', () => {
    expect(softDeleteOperation('findMany', 'Rally')).toBeNull();
    expect(softDeleteOperation('update', 'Rally')).toBeNull();
    expect(softDeleteOperation('delete', undefined)).toBeNull();
  });

  it('derives the model list from the schema', () => {
    expect(SOFT_DELETE_MODELS.has('Rally')).toBe(true);
    expect(SOFT_DELETE_MODELS.has('ParticipantRally')).toBe(false);
  });
});
