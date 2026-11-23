import type { GLAccount } from '../types/accounting.ts';

export const BANK_MASTER_OPTIONS = [
  'Shahjalal Islami Bank PLC',
  'Al-Arafah Islami Bank',
  'IBBL',
  'City Bank PLC',
  'BRAC Bank PLC',
  'Dutch-Bangla Bank PLC',
] as const;

export const UOM_MASTER_OPTIONS = [
  'Unit',
  'Unit/Set',
  'Pcs/Set',
  'Pcs/Meter',
  'Box',
  'Lot',
] as const;

export const WAREHOUSE_MASTER_OPTIONS = [
  'Dhaka Central Warehouse',
  'Gazipur Staging Yard',
  'Chattogram Port Bonded',
  'Client Site Deployed',
] as const;

export const ACCOUNTING_ITEM_TYPES = [
  'Stock',
  'Non-Stock',
  'Service',
  'Fixed Asset',
  'Consumable',
] as const;

export const CUSTOMER_TYPES = [
  'Corporate',
  'Government',
  'Institutional',
  'Distributor',
  'Individual',
] as const;

export const TAX_WITHHOLDING_CATEGORIES = [
  'Standard Corporate (TDS/VDS Applicable)',
  'Government / Statutory Body',
  'Tax Exempted Entity',
  'Import / Foreign Principal',
] as const;

export type MasterDataRole =
  | 'admin'
  | 'master_data_manager'
  | 'finance_manager'
  | 'accounts'
  | 'procurement'
  | 'sales'
  | 'warehouse'
  | 'auditor';

export function canManageMasterData(role: string): boolean {
  return ['admin', 'master_data_manager', 'finance_manager', 'accounts'].includes(role);
}

export function validateGlCategory(
  accounts: GLAccount[],
  glCode: string,
  expectedCategories: Array<GLAccount['category']>
): { valid: boolean; error?: string } {
  const acc = accounts.find((a) => a.code === glCode);
  if (!acc) return { valid: false, error: `GL Account '${glCode}' not found in Chart of Accounts.` };
  if (!expectedCategories.includes(acc.category)) {
    return {
      valid: false,
      error: `GL ${glCode} (${acc.name}) is category '${acc.category}', expected ${expectedCategories.join(' or ')}.`,
    };
  }
  return { valid: true };
}
