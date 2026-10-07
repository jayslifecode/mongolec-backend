import ExcelJS from 'exceljs';

export interface ExportOrderItem {
  name: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ExportOrder {
  orderNumber: string;
  createdAt: Date | string;
  status: string;
  customerName: string;
  phone: string;
  email?: string | null;
  address: string;
  deliveryMethod: string;
  paymentMethod: string;
  subtotal: number;
  discountTotal?: number | null;
  total: number;
  currency: string;
  items: ExportOrderItem[];
}

/** "2× Tee (M), 1× Mug" — a compact one-cell summary of an order's line items. */
const summarizeItems = (items: ExportOrderItem[]): string =>
  (items || [])
    .map(i => `${i.quantity}× ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`)
    .join(', ');

/**
 * Build an .xlsx workbook of orders (one row per order) and return it as a
 * base64 string the client can decode and download.
 */
export async function buildOrdersWorkbookBase64(orders: ExportOrder[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orders');
  ws.columns = [
    { header: 'Order #', key: 'orderNumber', width: 22 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Customer', key: 'customerName', width: 22 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Address', key: 'address', width: 32 },
    { header: 'Delivery', key: 'deliveryMethod', width: 12 },
    { header: 'Payment', key: 'paymentMethod', width: 12 },
    { header: 'Items', key: 'items', width: 44 },
    { header: 'Subtotal', key: 'subtotal', width: 12 },
    { header: 'Discount', key: 'discountTotal', width: 12 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Currency', key: 'currency', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const o of orders) {
    ws.addRow({
      orderNumber: o.orderNumber,
      date: new Date(o.createdAt).toISOString().slice(0, 19).replace('T', ' '),
      status: o.status,
      customerName: o.customerName,
      phone: o.phone,
      email: o.email ?? '',
      address: o.address,
      deliveryMethod: o.deliveryMethod,
      paymentMethod: o.paymentMethod,
      items: summarizeItems(o.items),
      subtotal: o.subtotal,
      discountTotal: o.discountTotal ?? 0,
      total: o.total,
      currency: o.currency,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString('base64');
}
