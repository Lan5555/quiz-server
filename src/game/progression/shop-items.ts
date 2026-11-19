
import type { EntityManager } from 'typeorm';
import type { ItemEffect, ItemId } from './catalog';

export interface ShopItemInput {
  requestId: string;
  name: string;
  effect: ItemEffect['effect'];
  power: number;
  price: number;
}

export interface ShopItem extends ItemEffect {
  id: ItemId;
  price: number;
}

export function itemDescription(effect: ItemEffect['effect'], power: number) {
  return effect === 'heal'
    ? `Restore ${power} HP to yourself or a living ally.`
    : `Guard yourself and add ${power} Focus.`;
}

export async function customItems(tx: EntityManager, id?: string): Promise<ShopItem[]> {
  const rows = await tx.query<Omit<ShopItem, 'description'>[]>(
    id
      ? 'SELECT id,name,effect,power,price FROM game_shop_items WHERE id=$1'
      : 'SELECT id,name,effect,power,price FROM game_shop_items ORDER BY created_at,id',
    id ? [id] : [],
  );
  return rows.map((row) => ({ ...row, description: itemDescription(row.effect, row.power) }));
}
