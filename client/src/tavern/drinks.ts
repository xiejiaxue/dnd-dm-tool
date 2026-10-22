/** Names from Alexandrian patron topics; prices, costs and dice table are game additions. */
export const DRINK_SOURCE = 'https://thealexandrian.net/wordpress/43312/roleplaying-games/a-night-in-trollskull-manor-patron-topics-agendas';
export type Drink = { id: string; name: string; tier: string; price: number; cost: number; origin: string };
export const DRINKS: Drink[] = [
  { id: 'house-ale', name: '酒馆淡麦酒', tier: '平价', price: 10, cost: 4, origin: '本游戏补充' },
  { id: 'dwarven-ale', name: '矮人麦酒', tier: '平价', price: 20, cost: 7, origin: '原文酒品' },
  { id: 'zzar', name: 'Zzar 杏香雪莉酒', tier: '精选', price: 30, cost: 11, origin: '原文酒品' },
  { id: 'tea', name: '异域花草茶', tier: '精选', price: 40, cost: 14, origin: '原文茶饮' },
  { id: 'blackberry', name: '黑莓海酒', tier: '珍酿', price: 60, cost: 21, origin: '原文酒品 · Blackberry Seawine' },
  { id: 'storm', name: '风暴巨人麦酒', tier: '珍酿', price: 80, cost: 28, origin: '原文酒品 · Storm Giant Ale' },
  { id: 'entsap', name: '树液酒', tier: '典藏', price: 120, cost: 42, origin: '原文酒品 · Entsap' },
  { id: 'berg', name: '冰酿', tier: '典藏', price: 200, cost: 70, origin: '原文酒品 · Berg Brew' },
];
export type DrinkDice = [number, number];
export type Orders = { dice: DrinkDice[]; menu: Drink[]; names: string[]; nonAlcoholic: number[]; supplement: number };
export function drinkIndex(dice: DrinkDice): number {
  const [tier, item] = dice;
  return (tier <= 10 ? 0 : tier <= 16 ? 2 : tier <= 19 ? 4 : 6) + (item <= 3 ? 0 : 1);
}
export function orderLines(orders: Orders) {
  return orders.dice.map((dice, i) => {
    const drink = orders.menu[orders.nonAlcoholic.includes(i) ? 3 : drinkIndex(dice)];
    return { guest: orders.names[i] ?? `普通顾客 ${i + 1 - orders.names.length}`, dice, drink, total: drink.price + orders.supplement, nonAlcoholic: orders.nonAlcoholic.includes(i) };
  });
}
export function orderTotals(orders: Orders) {
  const lines = orderLines(orders);
  const drinks = lines.reduce((n, x) => n + x.drink.price, 0);
  return { sales: drinks + lines.length * orders.supplement, ingredients: lines.reduce((n,x) => n + x.drink.cost + 18, 0) };
}
/** A bounded snapshot preserves historical prices and dice, without trusting import URLs. */
export function validOrders(v: unknown): v is Orders {
  if (!v || typeof v !== 'object') return false;
  const o = v as Orders;
  const int = (x: unknown, min: number, max: number) => Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max;
  return Array.isArray(o.dice) && o.dice.length >= 8 && o.dice.length <= 80 && o.dice.every(d => Array.isArray(d) && d.length === 2 && int(d[0],1,20) && int(d[1],1,6))
    && Array.isArray(o.menu) && o.menu.length === 8 && o.menu.every((d,i) => d && d.id === DRINKS[i].id && typeof d.name === 'string' && d.name.length <= 80 && typeof d.tier === 'string' && d.tier.length <= 10 && typeof d.origin === 'string' && d.origin.length <= 100 && int(d.price,1,10000) && int(d.cost,0,d.price))
    && Array.isArray(o.names) && o.names.length <= 6 && o.names.length <= o.dice.length && o.names.every(n => typeof n === 'string' && n.length <= 80)
    && Array.isArray(o.nonAlcoholic) && o.nonAlcoholic.length <= 6 && new Set(o.nonAlcoholic).size === o.nonAlcoholic.length && o.nonAlcoholic.every(i => int(i,0,o.names.length - 1))
    && int(o.supplement,0,200);
}
