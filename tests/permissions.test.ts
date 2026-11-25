import { assertPermission, hasPermission } from '../src/utils/permissions';
import { storyMutations } from '../src/graphql/resolvers/mutations/story';
import { nominationMutations } from '../src/graphql/resolvers/mutations/nomination';

const superAdmin = { roles: ['super_admin'], permissions: [] as string[] };
const tenantAdmin = {
  roles: ['admin'],
  permissions: [
    'content:create',
    'content:update',
    'content:delete',
    'content:publish',
    'media:create',
  ],
};
const editor = {
  roles: ['editor'],
  permissions: ['content:create', 'content:update', 'media:create'],
};

describe('hasPermission (permissions are "resource:action" strings)', () => {
  it('lets a super admin do anything', () => {
    expect(hasPermission(superAdmin, 'story:create')).toBe(true);
    expect(hasPermission(superAdmin, 'nomination:manage')).toBe(true);
  });

  it('matches an exact permission', () => {
    expect(hasPermission(editor, 'media:create')).toBe(true);
    expect(hasPermission(editor, 'media:delete')).toBe(false);
  });

  it('treats stories and park partners as content (no story:* permissions exist)', () => {
    expect(hasPermission(editor, 'story:create')).toBe(true);
    expect(hasPermission(editor, 'story:update')).toBe(true);
    expect(hasPermission(editor, 'story:delete')).toBe(false);
    expect(hasPermission(tenantAdmin, 'story:publish')).toBe(true);
    expect(hasPermission(tenantAdmin, 'partnership:delete')).toBe(true);
  });

  it('keeps nominations and newsletter (personal data) to admins', () => {
    expect(hasPermission(tenantAdmin, 'nomination:manage')).toBe(true);
    expect(hasPermission(tenantAdmin, 'newsletter:manage')).toBe(true);
    expect(hasPermission(editor, 'nomination:manage')).toBe(false);
    expect(hasPermission(editor, 'newsletter:manage')).toBe(false);
  });

  it('refuses anonymous callers', () => {
    expect(hasPermission(null, 'story:create')).toBe(false);
  });
});

describe('assertPermission', () => {
  it('asks anonymous callers to sign in', () => {
    expect(() => assertPermission({ user: null }, 'story:create')).toThrow(
      /Authentication required/
    );
  });

  it('names the missing permission', () => {
    expect(() => assertPermission({ user: editor }, 'nomination:manage')).toThrow(
      /nomination:manage/
    );
  });
});

describe('resolvers that used object-shaped permission checks now accept real permissions', () => {
  it('createStory lets a tenant admin through (it always said "Permission denied")', async () => {
    const context = {
      user: { ...tenantAdmin, id: 'u1', tenantId: 't1' },
      tenant: { id: 't1' },
      prisma: {
        story: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 's1' }),
        },
      },
    };
    await expect(
      storyMutations.createStory(
        null,
        { data: { slug: 'x', title: { en: 'X' }, content: {}, type: 'UPDATE' } },
        context
      )
    ).resolves.toBeDefined();
    expect(context.prisma.story.create).toHaveBeenCalled();
  });

  it('nomination actions refuse an editor with a clear permission error', async () => {
    const context = {
      user: { ...editor, id: 'u2', tenantId: 't1' },
      tenant: { id: 't1' },
      prisma: {},
    };
    await expect(
      nominationMutations.changeNominationStatus(null, { id: 'n1', status: 'APPROVED' }, context)
    ).rejects.toThrow(/nomination:manage/);
  });
});
