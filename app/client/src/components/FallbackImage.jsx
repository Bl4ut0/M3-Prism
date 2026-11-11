import { useState, useEffect } from 'react';
import { getAssetUrl, getNativeRelay } from '../api/api';
import { ImageOff } from 'lucide-react';
import clsx from 'clsx';

const FallbackImage = ({ src, alt, className, type = 'poster' }) => {
    const [error, setError] = useState(false);
    const [relayBlobUrl, setRelayBlobUrl] = useState(null);
    const [triedRelay, setTriedRelay] = useState(false);

    useEffect(() => {
        setError(false);
        setTriedRelay(false);
        setRelayBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
    }, [src]);

    const handleError = () => {
        if (!triedRelay && src && /^http:\/\//i.test(src)) {
            const relay = getNativeRelay();
            if (relay && typeof relay.fetch === 'function') {
                setTriedRelay(true);
                relay.fetch(src, { responseType: 'arraybuffer', timeout: 10000 })
                    .then(async (res) => {
                        if (!res.ok) throw new Error('Relay image fetch failed');
                        const buf = await res.arrayBuffer();
                        const blob = new Blob([buf], { type: res.contentType || 'image/jpeg' });
                        setRelayBlobUrl(URL.createObjectURL(blob));
                    })
                    .catch(() => setError(true));
                return;
            }
        }
        setError(true);
    };

    if (!src || error) {
        return (
            <div className={clsx("flex flex-col items-center justify-center bg-gray-900/50 text-gray-600 gap-2", className)}>
                <ImageOff className={type === 'icon' ? "w-4 h-4" : "w-8 h-8"} />
                {type === 'poster' && <span className="text-[10px] uppercase font-bold text-center px-2 line-clamp-1">{alt}</span>}
            </div>
        );
    }

    return (
        <img
            src={relayBlobUrl || getAssetUrl(src)}
            alt={alt}
            className={className}
            onError={handleError}
            loading="lazy"
        />
    );
};

export default FallbackImage;
