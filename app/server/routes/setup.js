const express = require('express');
const router = express.Router();
const { getRuntimeConfig, updateRuntimeConfig } = require('../runtimeConfig');

/**
 * SETUP & STATUS ROUTES
 * Centralized logic for application health, initial setup status, and runtime configuration.
 * Extracted from index.js to improve maintainability and separate system-level logic from media-level logic.
 */
module.exports = (db, getSetupState, setupMiddleware) => {

    // Global Health Check
    router.get('/status', (req, res) => {
        res.json({ status: 'online', version: '1.1.0' });
    });

    // App Setup Status (Used by Onboarding/Login redirect logic)
    router.get('/setup/status', (req, res) => {
        res.json(getSetupState());
    });

    // Runtime Configuration (TMDB Keys, User-Agents, etc.)
    const toPublicConfig = (runtimeConfig) => ({
        ...runtimeConfig.config,
        configPath: runtimeConfig.path,
        configSource: runtimeConfig.source,
    });

    router.get('/runtime/config', setupMiddleware, (req, res) => {
        res.json(toPublicConfig(getRuntimeConfig()));
    });

    router.put('/runtime/config', setupMiddleware, (req, res) => {
        try {
            const config = updateRuntimeConfig(req.body);
            res.json(toPublicConfig(config));
        } catch (error) {
            res.status(500).json({ error: 'Failed to update runtime configuration' });
        }
    });

    return router;
};
