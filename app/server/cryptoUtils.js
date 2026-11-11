const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'm3prism_premium_stable_secret_2024';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();
const ENCRYPTED_VALUE_PREFIX = 'v2';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.warn('[Security] JWT_SECRET is not configured. Set a strong, persistent JWT_SECRET for web-service deployments.');
}

const decryptSecret = (value) => {
    if (!value) return '';
    try {
        if (value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`)) {
            const [, ivHex, tagHex, ciphertextHex] = value.split(':');
            if (!ivHex || !tagHex || !ciphertextHex) return '';
            const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            return decipher.update(ciphertextHex, 'hex', 'utf8') + decipher.final('utf8');
        }

        // Backward compatibility for profiles written before authenticated encryption was introduced.
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, Buffer.alloc(16, 0));
        return decipher.update(value, 'hex', 'utf8') + decipher.final('utf8');
    } catch (e) {
        return '';
    }
};

const encryptSecret = (value) => {
    if (!value) return null;
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        const ciphertext = cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
        return `${ENCRYPTED_VALUE_PREFIX}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext}`;
    } catch (e) {
        return null;
    }
};

module.exports = {
    decryptSecret,
    encryptSecret,
    JWT_SECRET
};
