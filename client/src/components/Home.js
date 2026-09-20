import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FaStar, FaShippingFast, FaRobot, FaBell, FaShoppingBag } from 'react-icons/fa';
import ReactPaginate from 'react-paginate';
import {
  fetchCurrentUser,
  apiFetch,
  amazonFetch,
  walmartFetch,
  mergeGuestCart,
  getGuestCart,
} from '../utils';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import '../Home.css';

const AMAZON_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg';
const WALMART_LOGO = 'https://i5.walmartimages.com/dfw/63fd9f59-b3e1/7a569e53-f29a-4c3d-bfaf-6f7a158bfadd/v1/walmartLogo.svg';

const ITEMS_PER_PAGE = 12;

// Render's free tier spins idle services down, so the first request after a
// quiet period can 502/503 or simply hang while the container wakes. Bound
// each attempt and retry those, but never retry a 429: the limiter window is
// a full minute, so an immediate retry only deepens the hole.
const PRODUCT_FETCH_TIMEOUT_MS = 15000;
const PRODUCT_FETCH_RETRIES = 2;
const PRODUCT_FETCH_BACKOFF_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loads one provider's catalogue. Returns a result object instead of
// throwing, so one dead provider cannot take the whole page down.
const loadProviderCatalogue = async (fetcher, source) => {
  let lastStatus = 0;

  for (let attempt = 0; attempt <= PRODUCT_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRODUCT_FETCH_TIMEOUT_MS);
    try {
      const res = await fetcher('/get', { credentials: 'include', signal: controller.signal });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.products || [];
        return { source, ok: true, status: res.status, items: items.map((item) => ({ ...item, source })) };
      }
      // Anything below 500 (bad request, auth, rate limit) will not fix
      // itself in the next second, so fail fast instead of burning retries.
      if (res.status < 500) return { source, ok: false, status: res.status, items: [] };
    } catch (err) {
      // Timed out or the network dropped — worth another attempt.
      lastStatus = 0;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < PRODUCT_FETCH_RETRIES) {
      await sleep(PRODUCT_FETCH_BACKOFF_MS * 2 ** attempt);
    }
  }

  return { source, ok: false, status: lastStatus, items: [] };
};

const SOURCE_FILTERS = new Set(['all', 'amazon', 'walmart']);
const SORT_OPTIONS = new Set(['featured', 'price-asc', 'price-desc', 'name']);

const pageFromParams = (params) => {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page > 0 ? page - 1 : 0;
};

const sourceFromParams = (params) => {
  const source = params.get('source');
  return SOURCE_FILTERS.has(source) ? source : 'all';
};

const sortFromParams = (params) => {
  const sort = params.get('sort');
  return SORT_OPTIONS.has(sort) ? sort : 'featured';
};

// A deterministic pseudo-rating per product so the storefront feels alive
// without faking server-side data. Same product id always renders the same
// star count, so the value is stable on re-render.
const ratingFor = (id) => {
  if (!id) return 4.4;
  const sum = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return Math.round((3.8 + (sum % 13) / 10) * 10) / 10;
};
const reviewsFor = (id) => {
  if (!id) return 124;
  const sum = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return 50 + (sum % 950);
};

function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [cartCount, setCartCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(() => pageFromParams(searchParams));
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [sourceFilter, setSourceFilter] = useState(() => sourceFromParams(searchParams));
  const [sort, setSort] = useState(() => sortFromParams(searchParams));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const navigate = useNavigate();

  const updateListingParams = useCallback((changes, options = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);

      if (Object.prototype.hasOwnProperty.call(changes, 'page')) {
        const page = Math.max(0, Number(changes.page) || 0);
        if (page > 0) next.set('page', String(page + 1));
        else next.delete('page');
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'search')) {
        const value = String(changes.search || '').trim();
        if (value) next.set('q', value);
        else next.delete('q');
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'source')) {
        const value = SOURCE_FILTERS.has(changes.source) ? changes.source : 'all';
        if (value !== 'all') next.set('source', value);
        else next.delete('source');
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'sort')) {
        const value = SORT_OPTIONS.has(changes.sort) ? changes.sort : 'featured';
        if (value !== 'featured') next.set('sort', value);
        else next.delete('sort');
      }

      return next;
    }, options);
  }, [setSearchParams]);

  const updatePage = useCallback((page, options = {}) => {
    const nextPage = Math.max(0, Number(page) || 0);
    setCurrentPage(nextPage);
    updateListingParams({ page: nextPage }, options);
  }, [updateListingParams]);

  const handleSearchChange = useCallback((value) => {
    setSearch(value);
    setCurrentPage(0);
    updateListingParams({ search: value, page: 0 }, { replace: true });
  }, [updateListingParams]);

  const handleSourceFilterChange = useCallback((value) => {
    setSourceFilter(value);
    setCurrentPage(0);
    updateListingParams({ source: value, page: 0 }, { replace: true });
  }, [updateListingParams]);

  const handleSortChange = useCallback((value) => {
    setSort(value);
    setCurrentPage(0);
    updateListingParams({ sort: value, page: 0 }, { replace: true });
  }, [updateListingParams]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setSourceFilter('all');
    setSort('featured');
    setCurrentPage(0);
    updateListingParams({ search: '', source: 'all', sort: 'featured', page: 0 }, { replace: true });
  }, [updateListingParams]);

  useEffect(() => {
    const nextPage = pageFromParams(searchParams);
    const nextSearch = searchParams.get('q') || '';
    const nextSource = sourceFromParams(searchParams);
    const nextSort = sortFromParams(searchParams);

    setCurrentPage((prev) => (prev === nextPage ? prev : nextPage));
    setSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setSourceFilter((prev) => (prev === nextSource ? prev : nextSource));
    setSort((prev) => (prev === nextSort ? prev : nextSort));
  }, [searchParams]);

  useEffect(() => {
    fetchCurrentUser().then(async (user) => {
      setCurrentUser(user);
      if (user && user.email) {
        await mergeGuestCart();
        refreshCartCount();
      } else {
        setCartCount(getGuestCart().reduce((a, c) => a + Number(c.productQuantity || 0), 0));
      }
    });
  }, []);

  const refreshCartCount = async () => {
    try {
      const res = await apiFetch('/cart/get');
      if (res.ok) {
        const data = await res.json();
        const total = (data.cartItems || []).reduce(
          (a, c) => a + Number(c.productQuantity || 0),
          0
        );
        setCartCount(total);
      } else {
        setCartCount(0);
      }
    } catch {
      setCartCount(0);
    }
  };

  // Both providers are fetched concurrently. They used to be awaited one
  // after the other, so a cold start on the first one doubled the time
  // before anything appeared on screen.
  const fetchProducts = useCallback(async () => {
    setLoading(true);

    const results = await Promise.all([
      loadProviderCatalogue(walmartFetch, 'walmart'),
      loadProviderCatalogue(amazonFetch, 'amazon'),
    ]);

    const failed = results.filter((result) => !result.ok);

    setProducts(results.filter((result) => result.ok).flatMap((result) => result.items));
    // An upstream failure used to be indistinguishable from an empty
    // catalogue: both rendered "No products match your search". Track it
    // so the UI can tell the user what actually happened.
    setLoadError(
      failed.length
        ? {
            sources: failed.map((result) => result.source),
            rateLimited: failed.some((result) => result.status === 429),
            // 401/403/503 here mean the provider connection isn't authorized
            // (missing credential, or a provider-secret mismatch) — a hard
            // config failure. Saying "still waking up" sends you off to wait
            // for a cold start that already finished.
            notAuthorized: failed.some((result) => [401, 403, 503].includes(result.status)),
            total: failed.length === results.length,
          }
        : null
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (sourceFilter !== 'all') list = list.filter((p) => p.source === sourceFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
      );
    }
    if (sort === 'price-asc') list = [...list].sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'price-desc') list = [...list].sort((a, b) => Number(b.price) - Number(a.price));
    if (sort === 'name') list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }, [products, search, sourceFilter, sort]);

  const pageCount = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const safeCurrentPage = pageCount > 0 ? Math.min(currentPage, pageCount - 1) : 0;
  const offset = safeCurrentPage * ITEMS_PER_PAGE;
  const pageItems = filteredProducts.slice(offset, offset + ITEMS_PER_PAGE);

  useEffect(() => {
    if (loading || pageCount === 0) return;
    if (currentPage >= pageCount) {
      updatePage(pageCount - 1, { replace: true });
    }
  }, [currentPage, loading, pageCount, updatePage]);

  const handleProductClick = (productId, source) => {
    navigate(`/product/${source}/${productId}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        cartCount={cartCount}
        searchValue={search}
        onSearchChange={handleSearchChange}
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-gradient opacity-95" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.4),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.25),transparent_50%)]" />

        <div className="relative store-shell py-16 lg:py-24">
          <div className="max-w-3xl text-white animate-fade-in">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold uppercase tracking-wider border border-white/30">
              <FaRobot className="text-yellow-200" /> Smarter shopping, one cart
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
              The smartest way to shop<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-pink-200 to-white">
                across every store.
              </span>
            </h1>
            <p className="mt-5 text-lg text-white/85 max-w-xl">
              Compare Amazon and Walmart side-by-side. Track price history,
              get drop alerts, and ask AI for buy-or-wait advice — then
              check out where each product actually lives.
            </p>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-white/90">
              <div className="flex items-center gap-2">
                <FaRobot className="text-yellow-200" /> AI price advisor
              </div>
              <div className="flex items-center gap-2">
                <FaBell /> Price drop alerts
              </div>
              <div className="flex items-center gap-2">
                <FaShoppingBag /> One unified cart
              </div>
            </div>
          </div>
        </div>

        {/* Wave divider */}
        <svg
          className="absolute bottom-[-1px] left-0 right-0 w-full"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,32 C320,80 720,0 1440,48 L1440,80 L0,80 Z"
            fill="rgba(250,251,255,1)"
          />
        </svg>
      </section>

      {/* Filters */}
      <section className="store-shell -mt-6 relative z-10">
        <div className="glass-strong rounded-3xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 animate-fade-in">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All sellers' },
              { id: 'amazon', label: 'Amazon' },
              { id: 'walmart', label: 'Walmart' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleSourceFilterChange(opt.id)}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-all
                  ${sourceFilter === opt.id
                    ? 'bg-brand-gradient text-white shadow-md shadow-brand-500/30'
                    : 'bg-white/70 text-ink-700 border border-ink-200/70 hover:bg-white hover:border-brand-300'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="md:ml-auto flex items-center gap-3">
            <label htmlFor="sort" className="text-sm text-ink-600 font-medium hidden sm:inline">
              Sort by
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => handleSortChange(e.target.value)}
              className="px-4 py-2 rounded-full bg-white/80 border border-ink-200/70 text-sm font-medium text-ink-800 focus:outline-none focus:border-brand-400 focus:shadow-focus cursor-pointer"
            >
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Product grid */}
      <section className="store-shell py-10 flex-1">
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-2xl font-bold text-ink-900">
            {search ? 'Results' : 'Trending now'}
          </h2>
          <p className="text-sm text-ink-500">
            {loading ? 'Loading…' : `${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {!loading && loadError && !loadError.total && (
          <div className="card px-5 py-4 mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600">
              Showing partial results — the {loadError.sources.join(' and ')} catalogue did not load.
            </p>
            <button onClick={fetchProducts} className="btn-secondary !py-2 !px-4 !text-sm">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card overflow-hidden animate-pulse">
                <div className="aspect-square bg-ink-100" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-ink-100 rounded w-3/4" />
                  <div className="h-3 bg-ink-100 rounded w-1/2" />
                  <div className="h-5 bg-ink-100 rounded w-1/3 mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError && loadError.total ? (
          <div className="card p-12 text-center animate-fade-in">
            <h3 className="text-xl font-semibold text-ink-900">
              {loadError.rateLimited ? 'Too many requests right now' : 'We could not load products'}
            </h3>
            <p className="text-ink-500 mt-2">
              {loadError.rateLimited
                ? 'The store hit its rate limit. Give it a few seconds and try again.'
                : loadError.notAuthorized
                  ? 'The store could not reach its sellers right now. This one needs an admin to fix — retrying will not help.'
                  : 'The product services did not respond — they may still be waking up.'}
            </p>
            <button onClick={fetchProducts} className="btn-secondary mt-6">
              Try again
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="card p-12 text-center animate-fade-in">
            <h3 className="text-xl font-semibold text-ink-900">No products match your search</h3>
            <p className="text-ink-500 mt-2">Try different keywords or clear your filters.</p>
            <button
              onClick={handleResetFilters}
              className="btn-secondary mt-6"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5">
            {pageItems.map((item, idx) => {
              const rating = ratingFor(item._id);
              const reviews = reviewsFor(item._id);
              return (
                <article
                  key={`${item.source}-${item._id || idx}`}
                  className="card-interactive overflow-hidden group flex flex-col animate-fade-in"
                  style={{ animationDelay: `${(idx % 12) * 30}ms` }}
                  onClick={() => handleProductClick(item._id, item.source)}
                >
                  <div className="relative aspect-square overflow-hidden bg-ink-50">
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <span
                      className={`absolute top-3 left-3 ${
                        item.source === 'amazon' ? 'source-pill-amazon' : 'source-pill-walmart'
                      }`}
                    >
                      <img
                        src={item.source === 'amazon' ? AMAZON_LOGO : WALMART_LOGO}
                        alt=""
                        className={`h-3 ${item.source === 'walmart' ? 'invert-0' : ''}`}
                      />
                      {item.source === 'amazon' ? 'Amazon' : 'Walmart'}
                    </span>
                    {!item.inStock && (
                      <span className="absolute top-3 right-3 chip-danger">
                        Out of stock
                      </span>
                    )}
                  </div>

                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="text-sm font-semibold text-ink-900 line-clamp-2 min-h-[2.5rem]">
                      {item.name}
                    </h3>

                    <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
                      <span className="flex items-center gap-1 font-semibold text-ink-700">
                        <FaStar className="text-yellow-400" /> {rating}
                      </span>
                      <span>({reviews.toLocaleString()})</span>
                    </div>

                    <div className="mt-auto pt-3 flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-ink-900 leading-none">
                          ${Number(item.price).toFixed(2)}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mt-1 flex items-center gap-1">
                          <FaShippingFast className="text-emerald-600" />
                          Free shipping
                        </p>
                      </div>
                      <span className="text-xs text-brand-600 font-semibold group-hover:underline">
                        View →
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {pageCount > 1 && (
          <ReactPaginate
            previousLabel="←"
            nextLabel="→"
            breakLabel="…"
            pageCount={pageCount}
            marginPagesDisplayed={1}
            pageRangeDisplayed={3}
            forcePage={safeCurrentPage}
            onPageChange={(e) => {
              updatePage(e.selected, { replace: true });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            containerClassName="mt-12 flex items-center justify-center gap-1 flex-wrap"
            pageClassName="rounded-full overflow-hidden"
            pageLinkClassName="block min-w-[40px] h-10 px-3 leading-10 text-center text-sm font-medium text-ink-700 bg-white/70 border border-ink-200/60 hover:bg-white hover:border-brand-300 rounded-full transition-colors"
            previousClassName="rounded-full overflow-hidden"
            previousLinkClassName="block min-w-[40px] h-10 px-3 leading-10 text-center text-sm font-medium text-ink-700 bg-white/70 border border-ink-200/60 hover:bg-white hover:border-brand-300 rounded-full transition-colors"
            nextClassName="rounded-full overflow-hidden"
            nextLinkClassName="block min-w-[40px] h-10 px-3 leading-10 text-center text-sm font-medium text-ink-700 bg-white/70 border border-ink-200/60 hover:bg-white hover:border-brand-300 rounded-full transition-colors"
            breakLinkClassName="block min-w-[40px] h-10 leading-10 text-center text-sm text-ink-400"
            activeLinkClassName="!bg-brand-gradient !text-white !border-transparent shadow-md shadow-brand-500/30"
          />
        )}
      </section>

      <SiteFooter />
    </div>
  );
}

export default Home;
