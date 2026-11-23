# PK AI Tool

The application preserves all existing environment variable names and existing API routes. This update adds structured global verification, authenticator setup, email/mobile hooks, and device verification hooks. No provider or owner identity is exposed.

Configure Stripe Identity using the existing `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`, and `KYC_RETURN_URL` variables. Configure optional email/mobile/device integrations with the names listed in `.env.example`.
