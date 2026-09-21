import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, SearchX } from 'lucide-react';
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
import ProductCard from './ui/ProductCard';
import { Segmented, Select, Skeleton, EmptyState } from './ui/Primitives';

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

const SOURCE_TABS = [
  { id: 'all', label: 'All sellers' },
  { id: 'amazon', label: 'Amazon' },
  { id: 'walmart', label: 'Walmart' },
];

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

      {/* The product grid is the page. No editorial opening above it. */}
      <section className="shell-wide py-10 md:py-14 flex-1">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="t-h1">{search ? 'Results' : 'Trending now'}</h1>
            <p className="t-ui dim mt-1">
              {loading
                ? 'Loading…'
                : `${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              options={SOURCE_TABS}
              value={sourceFilter}
              onChange={handleSourceFilterChange}
              label="Filter by seller"
            />
            <Select
              id="sort"
              value={sort}
              onChange={(e) => handleSortChange(e.target.value)}
              aria-label="Sort products"
            >
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name (A–Z)</option>
            </Select>
          </div>
        </div>

        {!loading && loadError && !loadError.total && (
          <div className="notice mt-7">
            <AlertTriangle size={17} aria-hidden="true" />
            <div className="flex flex-wrap items-center justify-between gap-3 w-full">
              <p>
                Showing partial results — the {loadError.sources.join(' and ')} catalogue
                did not load.
              </p>
              <button type="button" onClick={fetchProducts} className="btn btn-quiet btn-sm">
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="mt-8">
          {loading ? (
            <div className="grid-tiles" aria-busy="true" aria-label="Loading products">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col pb-4">
                  <Skeleton className="aspect-square !rounded-tile" />
                  <Skeleton className="h-3.5 w-3/4 mt-4" />
                  <Skeleton className="h-3.5 w-1/2 mt-2" />
                  <Skeleton className="h-5 w-1/3 mt-3.5" />
                </div>
              ))}
            </div>
          ) : loadError && loadError.total ? (
            <EmptyState
              glyph={<AlertTriangle size={38} className="glyph !text-amber" aria-hidden="true" />}
              title={loadError.rateLimited ? 'Too many requests right now' : 'We could not load products'}
              action={
                <button type="button" onClick={fetchProducts} className="btn btn-blue btn-lg">
                  Try again
                </button>
              }
            >
              {loadError.rateLimited
                ? 'The store hit its rate limit. Give it a few seconds and try again.'
                : loadError.notAuthorized
                  ? 'The store could not reach its sellers right now. This one needs an admin to fix — retrying will not help.'
                  : 'The product services did not respond — they may still be waking up.'}
            </EmptyState>
          ) : filteredProducts.length === 0 ? (
            <EmptyState
              glyph={<SearchX size={38} className="glyph" aria-hidden="true" />}
              title="No products match your search"
              action={
                <button type="button" onClick={handleResetFilters} className="btn btn-quiet btn-lg">
                  Reset filters
                </button>
              }
            >
              Try different keywords or clear your filters.
            </EmptyState>
          ) : (
            <div className="grid-tiles">
              {pageItems.map((item, idx) => (
                <ProductCard
                  key={`${item.source}-${item._id || idx}`}
                  item={item}
                  onOpen={() => handleProductClick(item._id, item.source)}
                />
              ))}
            </div>
          )}
        </div>

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
            containerClassName="pager mt-12"
            pageLinkClassName="pager-link"
            activeClassName="pager-active"
            previousLinkClassName="pager-link"
            nextLinkClassName="pager-link"
            breakClassName="pager-break"
            breakLinkClassName="pager-link"
            disabledClassName="pager-disabled"
          />
        )}
      </section>

      <SiteFooter />
    </div>
  );
}

export default Home;
