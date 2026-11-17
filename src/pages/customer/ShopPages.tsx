import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Bot,
  Filter,
  Grid2x2,
  List,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  ProductCard,
  ProductImage,
  SkeletonCard,
  StatusBadge,
} from '../../components/ui/DesignSystem';
import { catalogApi, type CategoryDto, type ProductDto } from '../../services/api';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../domain/commercePolicy';

export function ShopPage() {
  const { slug: routeCategory } = useParams<{ slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToCart, toggleWishlist, toggleCompare, wishlistIds, compareSlugs } = useCart();

  const [q, setQ] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(routeCategory || searchParams.get('category') || '');
  const [brand, setBrand] = useState(searchParams.get('brand') || '');
  const [maxPriceInr, setMaxPriceInr] = useState(searchParams.get('maxPriceInr') || '');
  const [minRating, setMinRating] = useState(searchParams.get('minRating') || '');
  const [inStock, setInStock] = useState(searchParams.get('inStock') === 'true');
  const [sort, setSort] = useState(searchParams.get('sort') || 'popular');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routeCategory) setCategory(routeCategory);
  }, [routeCategory]);

  useEffect(() => {
    const paramQ = searchParams.get('q') || '';
    setQ(paramQ);
  }, [searchParams]);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, prodRes] = await Promise.all([
        catalogApi.categories(),
        catalogApi.products({
          q: q.trim() || undefined,
          category: category || undefined,
          brand: brand || undefined,
          maxPrice: maxPriceInr ? Number(maxPriceInr) * 100 : undefined,
          minRating: minRating ? Number(minRating) : undefined,
          inStock: inStock || undefined,
          sort,
          page,
          pageSize: 12,
        }),
      ]);
      setCategories(catRes.categories);
      setBrands(prodRes.brands);
      setProducts(prodRes.products);
      setTotal(prodRes.total);
      setTotalPages(prodRes.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, brand, maxPriceInr, minRating, inStock, sort, page, q]);

  const clearFilters = () => {
    setQ('');
    setCategory(routeCategory || '');
    setBrand('');
    setMaxPriceInr('');
    setMinRating('');
    setInStock(false);
    setSort('popular');
    setPage(1);
    setSearchParams({});
  };

  const handleAdd = async (p: ProductDto) => {
    if (!p.defaultVariantId) return;
    await addToCart({
      variantId: p.defaultVariantId,
      productId: p.id,
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      imageUrl: p.imageUrl,
      unitPricePaise: p.pricePaise,
      mrpPaise: p.mrpPaise,
      quantity: 1,
      availableToSell: p.availableToSell,
    });
  };

  const FilterControls = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-bold text-[#1F1647] mb-2">Search Keyword</label>
        <div className="relative">
          <Search className="w-4 h-4 text-[#6B6680] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Laptop, headphones, camera..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E7E1F2] bg-white text-sm focus:outline-none focus:border-[#7C3AED]"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-[#1F1647] mb-2">Category</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => {
              setCategory('');
              setPage(1);
            }}
            className={`w-full text-left px-3 py-2 rounded-xl text-sm cursor-pointer ${
              !category ? 'bg-[#F3F0FA] text-[#7C3AED] font-semibold' : 'text-[#211A35] hover:bg-[#F8F7FC]'
            }`}
          >
            All Categories
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategory(c.slug);
                setPage(1);
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center justify-between cursor-pointer ${
                category === c.slug ? 'bg-[#F3F0FA] text-[#7C3AED] font-semibold' : 'text-[#211A35] hover:bg-[#F8F7FC]'
              }`}
            >
              <span>{c.name}</span>
              <span className="text-xs text-[#6B6680] tabular-nums">{c.product_count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="filter-brand" className="block text-xs font-bold text-[#1F1647] mb-2">
          Brand
        </label>
        <select
          id="filter-brand"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setPage(1);
          }}
          className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] bg-white text-sm"
        >
          <option value="">All Brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="filter-budget" className="block text-xs font-bold text-[#1F1647] mb-2">
          Max Budget (INR)
        </label>
        <select
          id="filter-budget"
          value={maxPriceInr}
          onChange={(e) => {
            setMaxPriceInr(e.target.value);
            setPage(1);
          }}
          className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] bg-white text-sm"
        >
          <option value="">Any Budget</option>
          <option value="15000">Under ₹15,000</option>
          <option value="35000">Under ₹35,000</option>
          <option value="60000">Under ₹60,000</option>
          <option value="90000">Under ₹90,000</option>
        </select>
      </div>

      <div>
        <label htmlFor="filter-rating" className="block text-xs font-bold text-[#1F1647] mb-2">
          Minimum Rating
        </label>
        <select
          id="filter-rating"
          value={minRating}
          onChange={(e) => {
            setMinRating(e.target.value);
            setPage(1);
          }}
          className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] bg-white text-sm"
        >
          <option value="">All Ratings</option>
          <option value="4.5">4.5★ & above</option>
          <option value="4.0">4.0★ & above</option>
        </select>
      </div>

      <label className="flex items-center gap-2.5 text-sm font-medium text-[#211A35] cursor-pointer">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => {
            setInStock(e.target.checked);
            setPage(1);
          }}
          className="rounded border-[#E7E1F2] text-[#7C3AED]"
        />
        In-stock items only
      </label>

      <Button variant="outline" size="sm" onClick={clearFilters} className="w-full">
        Reset Filters
      </Button>
    </div>
  );

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Storefront Catalog</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5 capitalize">
            {category ? category.replace(/-/g, ' ') : 'All Products'}
          </h1>
          <p className="text-sm text-[#6B6680] mt-1 tabular-nums">
            Showing {products.length} of {total} verified products
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden"
          >
            <SlidersHorizontal className="w-4 h-4" /> Filters
          </Button>

          <select
            aria-label="Sort products"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            className="h-9 px-3 rounded-xl border border-[#E7E1F2] bg-white text-xs font-semibold text-[#211A35]"
          >
            <option value="popular">Most Popular</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="rating">Top Rated</option>
            <option value="newest">Newest Arrivals</option>
          </select>

          <div className="hidden sm:flex items-center border border-[#E7E1F2] rounded-xl bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`p-1.5 rounded-lg cursor-pointer ${viewMode === 'grid' ? 'bg-[#F3F0FA] text-[#7C3AED]' : 'text-[#6B6680]'}`}
            >
              <Grid2x2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              className={`p-1.5 rounded-lg cursor-pointer ${viewMode === 'list' ? 'bg-[#F3F0FA] text-[#7C3AED]' : 'text-[#6B6680]'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-8 items-start">
        {/* Desktop 250px Filter Sidebar */}
        <aside className="hidden lg:block w-[250px] shrink-0 card-surface p-5 sticky top-24">
          <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#E7E1F2]">
            <Filter className="w-4 h-4 text-[#7C3AED]" />
            <h2 className="text-sm font-bold text-[#1F1647]">Filters</h2>
          </div>
          <FilterControls />
        </aside>

        {/* Product Results */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => void loadCatalog()} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Search className="w-6 h-6" />}
              title="No matching products found"
              description="Try widening your budget or clearing active brand and rating filters."
              actionLabel="Reset All Filters"
              onAction={clearFilters}
            />
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  inWishlist={wishlistIds.has(p.id)}
                  inCompare={compareSlugs.includes(p.slug)}
                  onAddToCart={handleAdd}
                  onToggleWishlist={(item) => void toggleWishlist(item.id, item.name)}
                  onToggleCompare={(item) => toggleCompare(item.slug, item.name)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {products.map((p) => (
                <div key={p.id} className="card-surface p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <Link to={`/products/${p.slug}`} className="w-full sm:w-40 h-32 rounded-xl overflow-hidden bg-[#F3F0FA] shrink-0">
                    <ProductImage src={p.imageUrl} alt={p.name} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#6B6680] font-medium">
                      {p.brand} · {p.categoryName}
                    </p>
                    <Link to={`/products/${p.slug}`} className="text-base font-bold text-[#1F1647] hover:text-[#7C3AED] mt-0.5 block">
                      {p.name}
                    </Link>
                    <p className="text-sm text-[#6B6680] mt-1 line-clamp-2">{p.shortDescription}</p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-[#6B6680]">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#211A35]">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {p.rating.toFixed(1)}
                      </span>
                      <span>{p.availableToSell > 0 ? `${p.availableToSell} in stock` : 'Out of stock'}</span>
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 shrink-0">
                    <p className="text-xl font-bold text-[#1F1647] tabular-nums">{formatINR(p.pricePaise)}</p>
                    <Button size="sm" disabled={p.availableToSell <= 0} onClick={() => void handleAdd(p)}>
                      <ShoppingCart className="w-3.5 h-3.5" /> {p.availableToSell <= 0 ? 'Sold Out' : 'Add to Cart'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs font-semibold text-[#6B6680] px-3 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-[#1F1647]/40" onClick={() => setMobileFiltersOpen(false)} />
          <div className="relative w-80 max-w-[85vw] bg-white h-full p-5 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#E7E1F2]">
              <h2 className="text-base font-bold text-[#1F1647]">Filters</h2>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setMobileFiltersOpen(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#F3F0FA]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <FilterControls />
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    catalogApi
      .categories()
      .then((res) => setCategories(res.categories))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold text-[#7C3AED]">Browse Catalog</p>
        <h1 className="text-3xl font-bold text-[#1F1647] mt-0.5">All Categories</h1>
        <p className="text-sm text-[#6B6680] mt-1">Select a department to explore verified products and live inventory.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((cat) => (
            <Link key={cat.id} to={`/categories/${cat.slug}`} className="card-surface card-surface-hover overflow-hidden flex flex-col">
              <div className="h-44 bg-[#F3F0FA]">
                <ProductImage src={cat.image_url} alt={cat.name} />
              </div>
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#1F1647]">{cat.name}</h2>
                  <p className="text-sm text-[#6B6680] mt-1">{cat.description}</p>
                </div>
                <p className="mt-4 text-xs font-semibold text-[#7C3AED] tabular-nums">
                  {cat.product_count} products →
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComparePage() {
  const { compareSlugs, toggleCompare, clearCompare, addToCart } = useCart();
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (compareSlugs.length === 0) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(compareSlugs.map((slug) => catalogApi.productDetail(slug).then((r) => r.product).catch(() => null)))
      .then((res) => setProducts(res.filter((x): x is ProductDto => Boolean(x))))
      .finally(() => setLoading(false));
  }, [compareSlugs]);

  const specKeys = Array.from(new Set(products.flatMap((p) => Object.keys(p.specs || {}))));
  const bestValue = [...products].sort((a, b) => a.pricePaise / a.rating - b.pricePaise / b.rating)[0];
  const topRated = [...products].sort((a, b) => b.rating - a.rating)[0];

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Side-by-Side Matrix</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Compare Products</h1>
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" size="sm" onClick={() => navigate('/shop')}>
            Add More Products
          </Button>
          {products.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearCompare}>
              Clear All
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="w-6 h-6" />}
          title="No products selected for comparison"
          description="Tap the compare icon on up to 4 products in the catalog to inspect specs, ratings, and stock side by side."
          actionLabel="Browse Catalog"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <>
          <div className="aurora-soft-gradient border border-[#E7E1F2] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#1F1647]">Product Agent Comparison Summary</p>
                <p className="text-sm text-[#6B6680] mt-0.5">
                  Best value: <strong className="text-[#1F1647]">{bestValue?.name}</strong> ({formatINR(bestValue?.pricePaise || 0)}). Highest rated: <strong className="text-[#1F1647]">{topRated?.name}</strong> ({topRated?.rating.toFixed(1)}★).
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => navigate(`/ai?prompt=${encodeURIComponent(`Compare ${products.map((p) => p.name).join(' vs ')}`)}`)}
            >
              Ask AI for Trade-Offs
            </Button>
          </div>

          <div className="card-surface overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[#E7E1F2]">
                  <th className="p-4 w-44 text-xs font-bold text-[#6B6680] uppercase">Attribute</th>
                  {products.map((p) => (
                    <th key={p.id} className="p-4 align-top min-w-[200px]">
                      <div className="space-y-2">
                        <div className="h-32 rounded-xl overflow-hidden bg-[#F3F0FA]">
                          <ProductImage src={p.images?.[0]?.url || p.imageUrl} alt={p.name} />
                        </div>
                        <Link to={`/products/${p.slug}`} className="text-sm font-bold text-[#1F1647] hover:text-[#7C3AED] block">
                          {p.name}
                        </Link>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold text-[#7C3AED] tabular-nums">
                            {formatINR(p.variants[0]?.pricePaise || p.pricePaise)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleCompare(p.slug, p.name)}
                            className="text-xs text-[#EF4444] hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E1F2] text-sm">
                <tr>
                  <td className="p-4 font-semibold text-[#6B6680]">Brand</td>
                  {products.map((p) => (
                    <td key={p.id} className="p-4 font-medium">{p.brand}</td>
                  ))}
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#6B6680]">Rating</td>
                  {products.map((p) => (
                    <td key={p.id} className="p-4 tabular-nums font-semibold">
                      {p.rating.toFixed(1)}★ ({p.reviewCount})
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#6B6680]">Availability</td>
                  {products.map((p) => {
                    const avail = p.variants[0]?.availableToSell ?? p.availableToSell;
                    return (
                      <td key={p.id} className="p-4">
                        <StatusBadge
                          label={avail > 0 ? `${avail} in stock` : 'Out of stock'}
                          tone={avail > 0 ? 'success' : 'danger'}
                        />
                      </td>
                    );
                  })}
                </tr>
                {specKeys.map((k) => (
                  <tr key={k}>
                    <td className="p-4 font-semibold text-[#6B6680]">{k}</td>
                    {products.map((p) => (
                      <td key={p.id} className="p-4 text-[#211A35]">{p.specs?.[k] || '—'}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="p-4 font-semibold text-[#6B6680]">Action</td>
                  {products.map((p) => {
                    const v = p.variants[0];
                    const avail = v?.availableToSell ?? p.availableToSell;
                    return (
                      <td key={p.id} className="p-4">
                        <Button
                          size="sm"
                          disabled={!v || avail <= 0}
                          onClick={() =>
                            v &&
                            void addToCart({
                              variantId: v.id,
                              productId: p.id,
                              slug: p.slug,
                              name: p.name,
                              brand: p.brand,
                              variantTitle: v.title,
                              sku: v.sku,
                              imageUrl: p.images?.[0]?.url || p.imageUrl,
                              unitPricePaise: v.pricePaise,
                              mrpPaise: v.mrpPaise,
                              quantity: 1,
                              availableToSell: avail,
                            })
                          }
                        >
                          <ShoppingCart className="w-3.5 h-3.5" /> Add to Cart
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
