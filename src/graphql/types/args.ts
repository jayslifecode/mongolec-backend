/**
 * GraphQL Resolver Argument Type Definitions
 * These provide type safety for resolver arguments
 */

// ============================================
// Common Types
// ============================================

export type JSONValue = string | number | boolean | JSONObject | JSONArray | null;
export interface JSONObject {
  [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

export type LocalizedString = string | { en: string; fr?: string };

// ============================================
// Merchandise Types
// ============================================

export interface MerchProductVariantInput {
  title: string;
  sku?: string;
  price: number;
  compareAtPrice?: number;
  inventory?: number;
  isAvailable?: boolean;
  position?: number;
}

export interface MerchProductInput {
  name: LocalizedString;
  slug?: string;
  description: LocalizedString;
  shortDescription?: LocalizedString;
  sku?: string;
  barcode?: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  currency?: string;
  inventory?: number;
  trackInventory?: boolean;
  allowBackorder?: boolean;
  minStock?: number;
  maxStock?: number;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  featuredImage?: string;
  images?: string[];
  categoryId?: string;
  tags?: string[];
  hasVariants?: boolean;
  variants?: MerchProductVariantInput[];
  options?: Array<{
    name: string;
    values: string[];
  }>;
  metaTitle?: LocalizedString;
  metaDescription?: LocalizedString;
  searchKeywords?: string[];
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  isFeatured?: boolean;
  isDigital?: boolean;
  publishedAt?: Date;
  discountIds?: string[];
}

export interface CreateMerchProductArgs {
  input: MerchProductInput;
}

export interface UpdateMerchProductArgs {
  id: string;
  input: Partial<MerchProductInput>;
}

export interface DeleteMerchProductArgs {
  id: string;
}

export interface MerchCategoryInput {
  name: LocalizedString;
  slug?: string;
  description?: LocalizedString;
  parentId?: string;
}

export interface CreateMerchCategoryArgs {
  input: MerchCategoryInput;
}

export interface UpdateMerchCategoryArgs {
  id: string;
  input: Partial<MerchCategoryInput>;
}

// ============================================
// Content/CMS Types
// ============================================

export interface ContentInput {
  title: LocalizedString;
  slug?: string;
  content: LocalizedString;
  excerpt?: LocalizedString;
  type: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt?: Date;
  featuredImage?: string;
  seoTitle?: LocalizedString;
  seoDescription?: LocalizedString;
}

export interface CreateContentArgs {
  input: ContentInput;
}

export interface UpdateContentArgs {
  id: string;
  input: Partial<ContentInput>;
}

// ============================================
// User Types
// ============================================

export interface UpdateUserArgs {
  id: string;
  input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    roles?: string[];
    isActive?: boolean;
  };
}

export interface ApproveUserArgs {
  userId: string;
}

export interface RejectUserArgs {
  userId: string;
  reason: string;
}

// ============================================
// Rally Types
// ============================================

export interface RallyInput {
  title: LocalizedString;
  slug?: string;
  description: LocalizedString;
  startDate: Date;
  endDate: Date;
  location: JSONObject;
  duration: number;
  targetAudience: JSONObject;
  maxParticipants?: number;
  heroImage?: string;
  heroVideo?: string;
  gallery?: JSONObject;
  highlights?: JSONObject;
  impactOverview: JSONObject;
  conservationActivities: JSONObject;
  rangerPartnerships: JSONObject;
  isRecruiting?: boolean;
  applicationDeadline?: Date;
  cost?: JSONObject;
  depositAmount?: JSONObject;
  metaTitle?: LocalizedString;
  metaDescription?: LocalizedString;
  featuredImage?: string;
}

export interface CreateRallyArgs {
  input: RallyInput;
}

// ============================================
// Pagination Types
// ============================================

export interface PaginationArgs {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface MerchProductsArgs extends PaginationArgs {
  where?: {
    categoryId?: string;
    status?: string;
    search?: string;
    isFeatured?: boolean;
  };
}

// ============================================
// Authentication Types
// ============================================

export interface LoginArgs {
  email: string;
  password: string;
}

export interface RegisterArgs {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantSlug: string;
}

export interface RefreshTokenArgs {
  token: string;
}

// ============================================
// Upload Types
// ============================================

export interface CreatePresignedUploadUrlArgs {
  fileType: string;
  fileName?: string;
  fileSize?: number;
}
