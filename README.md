# Geofencing & Email Access Cloudflare Worker

A Cloudflare Worker that provides country-based access control (geofencing) with email authentication bypass capabilities.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Setup](#setup)
  - [KV Namespaces](#kv-namespaces)
  - [Environment Variables](#environment-variables)
- [Configuration](#configuration)
  - [Geofencing Settings](#geofencing-settings)
  - [Bypass Settings](#bypass-settings)
  - [Email Authentication](#email-authentication)
- [How It Works](#how-it-works)
  - [Country Detection](#country-detection)
  - [Email Authentication Flow](#email-authentication-flow)
  - [Bypass Mechanisms](#bypass-mechanisms)
- [Templates](#templates)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

This Cloudflare Worker implements a geofencing system that restricts website access based on the visitor's country, with intelligent subdomain routing based on location and language. It also provides an email-based authentication system that allows authorized users to bypass these restrictions.

## Features

- **Country-Based Access Control**: Restrict or redirect visitors based on their geographic location
- **Language-Based Subdomain Routing**: Automatically route users to language-specific subdomains
- **Email Authentication Bypass**: Allow specific email domains to access restricted content
- **Temporary Access Tokens**: Generate time-limited access links sent via email
- **Responsive UI**: Clean, mobile-friendly blocked page with authentication form
- **Dark Mode Support**: Email template supports light/dark mode

## Setup

### KV Namespaces

Create the following KV namespaces in your Cloudflare dashboard:

1. `GLOBAL_ALLOWED_EMAILS`: Stores globally allowed email domains
2. `SITE_ALLOWED_EMAILS`: Stores site-specific allowed email domains/addresses
3. `AUTH_TOKENS`: Stores temporary authentication tokens

### Environment Variables

Configure these environment variables in your Cloudflare Worker settings:

- `RESEND_API_KEY`: API key for Resend email service
- `SENDER_DOMAIN` (optional): Custom sender domain for emails

### KV Namespace Data Format

#### GLOBAL_ALLOWED_EMAILS
- Key: `@domain.com`
- Value: `1`

#### SITE_ALLOWED_EMAILS
- Key: `example.com:@domain.com` or `example.com:user@domain.com`
- Value: `1`

## Configuration

The worker includes several configurable settings at the top of the script:

### Geofencing Settings

```javascript
// Blocked page message
const message = "This website is not available in your country.";

// Country mapping - country code: subdomain (empty for default domain)
const countryMap = {
  CA: "en-ca",
  US: "",
  GU: "",
  PR: ""
};

// Language overrides - [country, language]: subdomain
const languageOverrides = {
  "US-es": "es-us"
};
```

### Bypass Settings

```javascript
// Bypass cookie settings
const bypassCookieName = "bypassCookie";
const bypassCookieValue = "qZF41KubXTD2JJ4EGSmw"; 
const bypassCookieExpiration = 60 * 60 * 24 * 30; // 30 days

// Bypass subdomains (e.g., staging environments)
const bypassSubs = ["stg"];
```

## How It Works

### Country Detection

1. The worker uses Cloudflare's built-in country detection (`request.cf.country`)
2. If the visitor's country is not in the `countryMap`, they see the blocked page
3. If their country is in the map, they're redirected to the appropriate subdomain

### Email Authentication Flow

1. User clicks "Need help?" on the blocked page
2. User enters their email in the authentication form
3. Worker checks if the email domain is allowed
4. If allowed, a unique token is generated and stored in KV
5. An access link is sent to the user's email
6. User clicks the link, which sets a bypass cookie
7. User can now access the site for 30 days from that browser

### Bypass Mechanisms

The worker allows access in these cases:
1. User has a valid bypass cookie
2. User is accessing from a bypass subdomain (e.g., `stg.example.com`)
3. User is already on the correct country-specific subdomain

## Templates

The worker includes three HTML templates:

1. **Blocked Page**: Shown to users from restricted countries
2. **Email Template**: Sent to users with an authentication link
3. **Confirmation Page**: Shown after submitting the email form

## Deployment

1. Create the required KV namespaces
2. Set up the environment variables
3. Deploy the worker to your Cloudflare account
4. Configure the worker route to match your domain

## Troubleshooting

Common issues:

- **Missing KV Namespaces**: Ensure all three required KV namespaces are created and bound to the worker
- **Email Not Sending**: Check that the `RESEND_API_KEY` is correctly configured
- **Incorrect Redirects**: Verify the `countryMap` and `languageOverrides` settings

For debugging, check the worker logs in the Cloudflare dashboard.

---

This worker was designed to provide a seamless, user-friendly geofencing solution with a secure authentication bypass mechanism for authorized users.


