import {
  ACCEPTANCE_PASSPORT_POLICY,
  ACCEPTANCE_PHOTO_POLICY,
  acceptanceUrl,
  decodeAcceptanceFile,
  generateAcceptanceToken,
  isAcceptanceToken,
  planRiderSync,
  riderSlug,
  validateAcceptanceInput,
  type SubmitAcceptanceInput,
} from '../src/libs/acceptance';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.7\n', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

function validInput(overrides: Partial<SubmitAcceptanceInput> = {}): SubmitAcceptanceInput {
  return {
    token: 'tok',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    agreedToCommitment: true,
    agreedToLiability: true,
    usePastPhotoAndBio: false,
    photo: { fileName: 'me.jpg', mimeType: 'image/jpeg', base64: JPEG.toString('base64') },
    bio: 'I ride.',
    shippingAddress: { street: '1 Main St', city: 'Ulaanbaatar', country: 'Mongolia' },
    tshirtSize: 'M',
    dietaryRestrictions: 'None',
    roomingPreference: 'TWIN',
    ...overrides,
  };
}

describe('acceptance tokens', () => {
  it('generates unguessable URL-safe tokens that differ every time', () => {
    const a = generateAcceptanceToken();
    const b = generateAcceptanceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(isAcceptanceToken(a)).toBe(true);
  });

  it('rejects malformed tokens before any database lookup', () => {
    expect(isAcceptanceToken('')).toBe(false);
    expect(isAcceptanceToken('short')).toBe(false);
    expect(isAcceptanceToken("x' OR 1=1 --xxxxxxxxxxxxxxxxxxxxxx")).toBe(false);
  });

  it('builds the public link on the configured site', () => {
    expect(acceptanceUrl('https://rallyforrangers.org/', 'abc')).toBe('https://rallyforrangers.org/acceptance/abc');
  });
});

describe('decodeAcceptanceFile', () => {
  it('decodes a JPEG photo, also from a data URL', () => {
    const file = decodeAcceptanceFile(
      { fileName: 'me.jpg', mimeType: 'image/jpeg', base64: `data:image/jpeg;base64,${JPEG.toString('base64')}` },
      ACCEPTANCE_PHOTO_POLICY
    );
    expect(file.buffer.equals(JPEG)).toBe(true);
    expect(file.extension).toBe('jpg');
  });

  it('accepts PNG and WebP photos and a PDF passport', () => {
    expect(decodeAcceptanceFile({ fileName: 'a.png', mimeType: 'image/png', base64: PNG.toString('base64') }, ACCEPTANCE_PHOTO_POLICY).extension).toBe('png');
    expect(decodeAcceptanceFile({ fileName: 'a.webp', mimeType: 'image/webp', base64: WEBP.toString('base64') }, ACCEPTANCE_PHOTO_POLICY).extension).toBe('webp');
    expect(decodeAcceptanceFile({ fileName: 'p.pdf', mimeType: 'application/pdf', base64: PDF.toString('base64') }, ACCEPTANCE_PASSPORT_POLICY).extension).toBe('pdf');
  });

  it('refuses a type the policy does not allow', () => {
    expect(() =>
      decodeAcceptanceFile({ fileName: 'p.pdf', mimeType: 'application/pdf', base64: PDF.toString('base64') }, ACCEPTANCE_PHOTO_POLICY)
    ).toThrow('Photo must be a JPG, PNG or WebP image');
  });

  it('refuses content that does not match its declared type (e.g. a script renamed .jpg)', () => {
    const fake = Buffer.from('<script>alert(1)</script>').toString('base64');
    expect(() => decodeAcceptanceFile({ fileName: 'x.jpg', mimeType: 'image/jpeg', base64: fake }, ACCEPTANCE_PHOTO_POLICY)).toThrow(
      'Photo does not look like a JPG, PNG or WebP image'
    );
  });

  it('refuses files over the size limit and empty files', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(ACCEPTANCE_PHOTO_POLICY.maxBytes)]).toString('base64');
    expect(() => decodeAcceptanceFile({ fileName: 'big.jpg', mimeType: 'image/jpeg', base64: big }, ACCEPTANCE_PHOTO_POLICY)).toThrow(
      'Photo is too large (max 4 MB)'
    );
    expect(() => decodeAcceptanceFile({ fileName: 'e.jpg', mimeType: 'image/jpeg', base64: '' }, ACCEPTANCE_PHOTO_POLICY)).toThrow(
      'Photo is empty'
    );
  });

  it('keeps only a safe file name', () => {
    const file = decodeAcceptanceFile(
      { fileName: '../../etc/pass port<>.pdf', mimeType: 'application/pdf', base64: PDF.toString('base64') },
      ACCEPTANCE_PASSPORT_POLICY
    );
    expect(file.fileName).toBe('pass_port__.pdf');
  });
});

describe('validateAcceptanceInput', () => {
  it('accepts a complete submission', () => {
    expect(validateAcceptanceInput(validInput(), { hasPastProfile: false })).toEqual([]);
  });

  it('requires both agreements', () => {
    expect(validateAcceptanceInput(validInput({ agreedToCommitment: false, agreedToLiability: false }), { hasPastProfile: false })).toEqual([
      'Please agree to the Letter of Commitment.',
      'Please agree to the liability agreement.',
    ]);
  });

  it('requires a photo and bio unless the rider reuses a past profile we actually have', () => {
    const noPhoto = validInput({ photo: null, bio: '  ' });
    expect(validateAcceptanceInput(noPhoto, { hasPastProfile: false })).toEqual([
      'Please upload your photo.',
      'Please write or paste your bio.',
    ]);
    expect(validateAcceptanceInput({ ...noPhoto, usePastPhotoAndBio: true }, { hasPastProfile: true })).toEqual([]);
    expect(validateAcceptanceInput({ ...noPhoto, usePastPhotoAndBio: true }, { hasPastProfile: false })).toEqual([
      "We don't have a past photo and bio for you yet. Please upload them.",
    ]);
  });

  it('checks contact, address, rooming and lengths', () => {
    const errors = validateAcceptanceInput(
      validInput({
        email: 'not-an-email',
        shippingAddress: { street: '', city: '', country: '' },
        tshirtSize: '',
        dietaryRestrictions: '',
        roomingPreference: 'PENTHOUSE' as never,
        questions: 'x'.repeat(5001),
      }),
      { hasPastProfile: false }
    );
    expect(errors).toEqual([
      'Please enter a valid email address.',
      'Please enter your street address.',
      'Please enter your city.',
      'Please enter your country.',
      'Please enter your T-shirt size.',
      'Please list any allergies or dietary restrictions (or "None").',
      'Please choose a rooming preference.',
      'Questions must be 5000 characters or fewer.',
    ]);
  });
});

describe('upload caps keep a full submission under the 10 MB request limit', () => {
  it('photo 4 MB + passport 3 MB stay under 10 MB once base64-encoded', () => {
    const base64Bytes = (bytes: number) => Math.ceil(bytes / 3) * 4;
    expect(ACCEPTANCE_PHOTO_POLICY.maxBytes).toBe(4 * 1024 * 1024);
    expect(ACCEPTANCE_PASSPORT_POLICY.maxBytes).toBe(3 * 1024 * 1024);
    expect(base64Bytes(ACCEPTANCE_PHOTO_POLICY.maxBytes) + base64Bytes(ACCEPTANCE_PASSPORT_POLICY.maxBytes)).toBeLessThan(10 * 1024 * 1024);
  });
});

describe('riderSlug', () => {
  it('matches the importer slug rule (accents folded, punctuation to dashes)', () => {
    expect(riderSlug('Anna-Louise', 'Emrich')).toBe('anna-louise-emrich');
    expect(riderSlug('André', "D'Avanzo")).toBe('andre-d-avanzo');
    expect(riderSlug('Martin', '')).toBe('martin');
  });
});

describe('planRiderSync (confirming a rider puts them on the roster)', () => {
  const acceptance = { usePastPhotoAndBio: false, photoUrl: 'https://cdn/new.jpg', bio: 'New bio' };

  it('creates a new rider with the acceptance photo as the featured photo and the bio', () => {
    const plan = planRiderSync({ firstName: 'Jane', lastName: 'Doe', country: 'USA', acceptance, existing: null });
    expect(plan).toEqual({
      kind: 'create',
      data: { firstName: 'Jane', lastName: 'Doe', slug: 'jane-doe', country: 'USA', photo: 'https://cdn/new.jpg', bio: 'New bio' },
    });
  });

  it('updates a returning rider: the new rally photo becomes the featured photo, the new bio replaces the old', () => {
    const existing = { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'Old bio' };
    expect(planRiderSync({ firstName: 'Jane', lastName: 'Doe', country: 'USA', acceptance, existing })).toEqual({
      kind: 'update',
      id: 'p1',
      data: { photo: 'https://cdn/new.jpg', bio: 'New bio' },
    });
  });

  it('keeps the past photo and bio when the rider asked us to reuse them', () => {
    const existing = { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'Old bio' };
    const reuse = { usePastPhotoAndBio: true, photoUrl: null, bio: null };
    expect(planRiderSync({ firstName: 'Jane', lastName: 'Doe', country: 'USA', acceptance: reuse, existing })).toEqual({
      kind: 'update',
      id: 'p1',
      data: {},
    });
  });
});
