import type { AcceptanceFileInput } from './files';

export const ROOMING_PREFERENCES = ['TWIN', 'SINGLE'] as const;
export type RoomingPreference = (typeof ROOMING_PREFERENCES)[number];

export interface AcceptanceAddressInput {
  street: string;
  street2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string;
}

export interface SubmitAcceptanceInput {
  token: string;
  firstName: string;
  lastName: string;
  email: string;
  agreedToCommitment: boolean;
  agreedToLiability: boolean;
  usePastPhotoAndBio: boolean;
  photo?: AcceptanceFileInput | null;
  bio?: string | null;
  shippingAddress: AcceptanceAddressInput;
  tshirtSize: string;
  dietaryRestrictions: string;
  roomingPreference: RoomingPreference;
  roommatePreference?: string | null;
  passport?: AcceptanceFileInput | null;
  questions?: string | null;
  honeypot?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_EMAIL = 200;
const MAX_LINE = 200;
const MAX_SIZE = 20;
const MAX_TEXT = 5000;

function blank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function tooLong(value: string | null | undefined, max: number): boolean {
  return (value ?? '').length > max;
}

/**
 * Returns user-facing messages for every problem in an acceptance submission (empty = valid).
 * `hasPastProfile`: we already hold a photo or bio for this rider, so "use my past photo and
 * bio" is allowed instead of uploading new ones.
 */
export function validateAcceptanceInput(
  input: SubmitAcceptanceInput,
  { hasPastProfile }: { hasPastProfile: boolean }
): string[] {
  const errors: string[] = [];
  const add = (condition: boolean, message: string) => {
    if (condition) errors.push(message);
  };

  add(blank(input.firstName) || tooLong(input.firstName, MAX_NAME), 'Please enter your first name.');
  add(blank(input.lastName) || tooLong(input.lastName, MAX_NAME), 'Please enter your last name.');
  add(!EMAIL_PATTERN.test((input.email ?? '').trim()) || tooLong(input.email, MAX_EMAIL), 'Please enter a valid email address.');
  add(input.agreedToCommitment !== true, 'Please agree to the Letter of Commitment.');
  add(input.agreedToLiability !== true, 'Please agree to the liability agreement.');

  if (input.usePastPhotoAndBio) {
    add(!hasPastProfile, "We don't have a past photo and bio for you yet. Please upload them.");
  } else {
    add(!input.photo, 'Please upload your photo.');
    add(blank(input.bio), 'Please write or paste your bio.');
  }
  add(tooLong(input.bio, MAX_TEXT), 'Your bio must be 5000 characters or fewer.');

  const address = input.shippingAddress ?? ({} as AcceptanceAddressInput);
  add(blank(address.street) || tooLong(address.street, MAX_LINE), 'Please enter your street address.');
  add(tooLong(address.street2, MAX_LINE), 'Street address line 2 is too long.');
  add(blank(address.city) || tooLong(address.city, MAX_LINE), 'Please enter your city.');
  add(tooLong(address.state, MAX_LINE) || tooLong(address.postalCode, MAX_LINE), 'State or postal code is too long.');
  add(blank(address.country) || tooLong(address.country, MAX_LINE), 'Please enter your country.');

  add(blank(input.tshirtSize) || tooLong(input.tshirtSize, MAX_SIZE), 'Please enter your T-shirt size.');
  add(
    blank(input.dietaryRestrictions) || tooLong(input.dietaryRestrictions, MAX_TEXT),
    'Please list any allergies or dietary restrictions (or "None").'
  );
  add(!ROOMING_PREFERENCES.includes(input.roomingPreference), 'Please choose a rooming preference.');
  add(tooLong(input.roommatePreference, MAX_LINE), 'Roommate preference must be 200 characters or fewer.');
  add(tooLong(input.questions, MAX_TEXT), 'Questions must be 5000 characters or fewer.');

  return errors;
}
