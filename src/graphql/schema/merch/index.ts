import gql from 'graphql-tag';

/**
 * Merch Schema
 * E-commerce products and categories management
 */
export const merchSchema = gql`
  # ============================================
  # Merch Types
  # ============================================

  type MerchProduct {
    id: ID!
    sku: String
    name: JSON!
    description: JSON
    shortDescription: JSON
    price: Float!
    compareAtPrice: Float
    costPrice: Float
    currency: String
    inventory: Int!
    trackInventory: Boolean!
    allowBackorder: Boolean
    minStock: Int
    maxStock: Int
    weight: Float
    dimensions: JSON
    featuredImage: String
    images: JSON
    categoryId: String
    category: MerchCategory
    tags: JSON
    hasVariants: Boolean!
    options: JSON
    variants: [MerchVariant!]
    metaTitle: JSON
    metaDescription: JSON
    searchKeywords: JSON
    status: String!
    isFeatured: Boolean!
    isDigital: Boolean
    publishedAt: DateTime
    discounts: [MerchDiscount!]
    activeDiscount: MerchDiscount
    discountedPrice: Float
    discountAmount: Float
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type MerchVariant {
    id: ID!
    sku: String!
    barcode: String
    title: JSON
    optionValues: JSON!
    price: Float!
    compareAtPrice: Float
    costPrice: Float
    inventory: Int!
    weight: Float
    dimensions: JSON
    image: String
    position: Int!
    isAvailable: Boolean!
    productId: ID!
    product: MerchProduct
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type MerchCategory {
    id: ID!
    name: JSON!
    slug: String!
    description: JSON
    color: String
    icon: String
    image: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum MerchDiscountType {
    PERCENT
    AMOUNT
  }

  type MerchDiscount {
    id: ID!
    name: String!
    type: MerchDiscountType!
    value: Float!
    startDate: DateTime!
    endDate: DateTime!
    isActive: Boolean!
    productIds: [ID!]
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreateMerchDiscountInput {
    name: String!
    type: MerchDiscountType!
    value: Float!
    startDate: DateTime!
    endDate: DateTime!
    isActive: Boolean
    productIds: [ID!]
  }

  input UpdateMerchDiscountInput {
    name: String
    type: MerchDiscountType
    value: Float
    startDate: DateTime
    endDate: DateTime
    isActive: Boolean
    productIds: [ID!]
  }

  input VariantOptionInput {
    name: JSON!
    values: [JSON!]!
  }

  input CreateVariantInput {
    sku: String!
    barcode: String
    title: JSON
    optionValues: JSON!
    price: Float!
    compareAtPrice: Float
    costPrice: Float
    inventory: Int
    weight: Float
    dimensions: JSON
    image: String
    position: Int
    isAvailable: Boolean
  }

  input UpdateVariantInput {
    sku: String
    barcode: String
    title: JSON
    optionValues: JSON
    price: Float
    compareAtPrice: Float
    costPrice: Float
    inventory: Int
    weight: Float
    dimensions: JSON
    image: String
    position: Int
    isAvailable: Boolean
  }

  input CreateMerchProductInput {
    sku: String
    name: JSON!
    description: JSON
    shortDescription: JSON
    price: Float!
    compareAtPrice: Float
    costPrice: Float
    currency: String
    inventory: Int
    trackInventory: Boolean
    allowBackorder: Boolean
    minStock: Int
    maxStock: Int
    weight: Float
    dimensions: JSON
    featuredImage: String
    images: JSON
    categoryId: ID
    tags: JSON
    hasVariants: Boolean
    options: JSON
    variants: [CreateVariantInput!]
    metaTitle: JSON
    metaDescription: JSON
    searchKeywords: JSON
    status: String!
    isFeatured: Boolean
    isDigital: Boolean
    publishedAt: DateTime
    discountIds: [ID!]
  }

  input UpdateMerchProductInput {
    sku: String
    name: JSON
    description: JSON
    shortDescription: JSON
    price: Float
    compareAtPrice: Float
    costPrice: Float
    currency: String
    inventory: Int
    trackInventory: Boolean
    allowBackorder: Boolean
    minStock: Int
    maxStock: Int
    weight: Float
    dimensions: JSON
    featuredImage: String
    images: JSON
    categoryId: ID
    tags: JSON
    hasVariants: Boolean
    options: JSON
    variants: [CreateVariantInput!]
    metaTitle: JSON
    metaDescription: JSON
    searchKeywords: JSON
    status: String
    isFeatured: Boolean
    isDigital: Boolean
    publishedAt: DateTime
    discountIds: [ID!]
  }

  input CreateMerchCategoryInput {
    name: JSON!
    slug: String!
    description: JSON
  }

  input UpdateMerchCategoryInput {
    name: JSON
    slug: String
    description: JSON
  }

  # ============================================
  # Merch Queries
  # ============================================

  extend type Query {
    getMerchProducts(
      language: String
      status: String
      categoryId: ID
      isFeatured: Boolean
      tenantId: ID
      tenantSlug: String
      limit: Int
      offset: Int
    ): [MerchProduct!]!
    getMerchProductById(id: ID!, language: String): MerchProduct
    getMerchCategories(language: String): [MerchCategory!]!
    getMerchCategoryById(id: ID!, language: String): MerchCategory
    getMerchDiscounts(
      tenantId: ID
      tenantSlug: String
      isActive: Boolean
      limit: Int
      offset: Int
    ): [MerchDiscount!]!
    getMerchDiscountById(id: ID!): MerchDiscount
  }

  # ============================================
  # Merch Mutations
  # ============================================

  extend type Mutation {
    # Product mutations
    createMerchProduct(input: CreateMerchProductInput!): MerchProduct!
    updateMerchProduct(id: ID!, input: UpdateMerchProductInput!): MerchProduct!
    deleteMerchProduct(id: ID!): Boolean!

    # Variant mutations
    createMerchVariant(productId: ID!, input: CreateVariantInput!): MerchVariant!
    updateMerchVariant(id: ID!, input: UpdateVariantInput!): MerchVariant!
    deleteMerchVariant(id: ID!): Boolean!

    # Category mutations
    createMerchCategory(input: CreateMerchCategoryInput!): MerchCategory!
    updateMerchCategory(id: ID!, input: UpdateMerchCategoryInput!): MerchCategory!
    deleteMerchCategory(id: ID!): Boolean!

    # Discount mutations
    createMerchDiscount(input: CreateMerchDiscountInput!): MerchDiscount!
    updateMerchDiscount(id: ID!, input: UpdateMerchDiscountInput!): MerchDiscount!
    deleteMerchDiscount(id: ID!): Boolean!
  }
`;
