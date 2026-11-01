export default function WatchItemCard({ item }) {
  return (
    <div className="rounded-xl bg-gray-800 p-4">
      <img src={item.image} alt={item.name} className="w-full" />
      <h3 className="mt-2 font-semibold">{item.name}</h3>
      <p className="text-sm text-gray-400">{item.priceCoins} coins</p>
    </div>
  );
}