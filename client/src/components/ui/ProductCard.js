import React from 'react';
import { Truck } from 'lucide-react';
import SourcePill from '../SourcePill';
import { Stars } from './Primitives';
import { ratingFor, reviewsFor, formatPrice } from '../../productMeta';

/**
 * The Home grid tile.
 *
 * Image centred on haze, metadata left-aligned beneath — a card carrying a
 * seller, a two-line name, a rating, a price and a shipping line is
 * unreadable when every row is centred.
 *
 * Everything shown comes from the provider's own record: `imageUrl`, `name`,
 * `price`, `inStock` and `source`. The rating and review count are the app's
 * existing derived values from productMeta.js, not stored data.
 */
function ProductCard({ item, onOpen }) {
    const rating = ratingFor(item._id);
    const reviews = reviewsFor(item._id);

    return (
        <button type="button" className="tile group" onClick={onOpen}>
            <span className="tile-art">
                <img src={item.imageUrl} alt={item.name} loading="lazy" />
                {!item.inStock && <span className="tile-oos">Out of stock</span>}
            </span>

            <span className="tile-body">
                <SourcePill provider={item.source} size="xs" />

                <span className="tile-name">{item.name}</span>

                <span className="flex items-center gap-1.5 text-cap">
                    <Stars rating={rating} size={12} />
                    <span className="font-medium">{rating.toFixed(1)}</span>
                    <span className="dimmer">({reviews.toLocaleString()})</span>
                </span>

                <span className="tile-price tnum">{formatPrice(item.price)}</span>

                <span className="tile-ship">
                    <Truck size={13} aria-hidden="true" />
                    Free shipping
                </span>

                <span className="tile-cta">View</span>
            </span>
        </button>
    );
}

export default ProductCard;
