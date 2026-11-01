export default function MarketFilters({ filters, setFilters }) {
  return (
    <div className="p-4 bg-gray-900 rounded-xl mb-4">
      <h2 className="font-semibold mb-2">Filters</h2>

      <input
        className="input input-bordered w-full mb-2"
        placeholder="Search..."
        value={filters.q || ""}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
      />

      <input
        className="input input-bordered w-full"
        placeholder="Min discount %"
        value={filters.minDiscountPct || ""}
        onChange={(e) =>
          setFilters((f) => ({ ...f, minDiscountPct: e.target.value }))
        }
      />
    </div>
  );
}
