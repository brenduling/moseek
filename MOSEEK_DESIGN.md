# Moseek design and product identity

This document is authoritative for future Moseek UI and product decisions.

## Product identity

**Product:** Moseek

**Tagline:** Hello! We're Here!

Moseek combines two ideas: **mosaic**, where scattered pieces become one meaningful whole, and **seek**, the act of finding, seeing, and understanding what matters. Moseek brings scattered work into a coherent digital **Environment**.

The core object is an Environment. An Environment should feel like entering the digital place where a piece of work lives. It can hold a thesis, software project, research project, event, organization work, or personal project. It can reference work that remains in Google Drive, GitHub, Figma, and other services.

### Environment types

**Personal Environment**

- Private working space
- Personal resources
- Notes and reminders
- Personal organization

**Shared Environment**

- Collaborative work and shared resources
- Members and announcements
- Activity and revisions
- Progress

A Shared Environment may connect to a user's Personal space without duplicating shared resources. Personal is the user's private layer around that shared work.

## Core interaction philosophy

The primary Environment interface will eventually be an infinite spatial canvas. Think of Figma, a large desk, a quiet studio, or a project wall. Users should be able to pan, zoom, place and move resources, group related resources, and arrange work spatially.

Avoid admin and analytics dashboards, dense productivity software, and grids of KPI cards. Whitespace is functional; never fill space simply because it exists.

## Personality and feeling

Moseek is observant, calm, intelligent, spatial, quietly friendly, reassuring, curious, and organized without feeling rigid. It should feel like a capable teammate who quietly knows where everything is.

It is not childish, cartoonish, corporate, loud, styled like a productivity guru, gradient-heavy, or visually cluttered.

Desired reaction: **“Ah. Everything is here.”**

## Brand principle

**Moseek is the frame. Your work is the color.**

The application is predominantly monochrome. Color comes primarily from user content, service identities, files, images, Environment covers, and avatars. Do not use generic SaaS purple or blue gradients as the Moseek identity.

## Visual system

### Colors

These are the exact color tokens, defined in `src/styles/tokens.css`:

| Token | Value |
| --- | --- |
| `--moseek-black` | `#111111` |
| `--black` | `#000000` |
| `--canvas` | `#FAFAF8` |
| `--surface` | `#FFFFFF` |
| `--surface-soft` | `#F4F4F1` |
| `--border` | `#E6E6E2` |
| `--text-primary` | `#151515` |
| `--text-secondary` | `#686868` |
| `--text-muted` | `#989898` |

Do not add a primary purple, blue, green, or gradient.

### Typography

Use Inter as the intended UI typeface, with sensible system fallbacks. Keep typography restrained and avoid oversized marketing headings inside the application. Establish hierarchy through spacing first, then typography, borders, and subtle elevation.

### Shape and elevation

- Buttons: approximately 8–10px radius
- Panels: approximately 12px radius
- Resources: approximately 12–16px radius
- Environment thumbnails: approximately 16px radius

Avoid excessive pill-shaped controls and heavy shadows.

### Logo identity

The lowercase wordmark is **moseek**. Its signature is the double **ee**: the two letterforms should read as eyes first, then as **ee** on a second look. The eyes suggest seeing, finding, awareness, observation, and presence. Keep the treatment minimal and professional. Eventually, **ee** can stand alone as the emblem, favicon, compact mark, and app icon. Do not recreate the final logo with emoji or generic eye icons.

## Voice

Communicate briefly, naturally, and calmly. Preferred examples:

- Nothing here yet.
- It's here.
- Your Environment is ready.
- Your first space starts here.
- Welcome back. Here's where things stand.

Avoid robotic success messages, forced jokes, motivational productivity language, and excessive exclamation marks. The tagline **Hello! We're Here!** is intentionally warmer and keeps its punctuation.

## Motion

Motion should be subtle and physically coherent: smooth movement, gentle transitions, subtle fade or scale, and smooth canvas pan and zoom. Avoid bouncing UI, excessive spring animations, and constant mascot movement.

## Product rules

1. **Moseek is an Environment, not a dashboard.** Never default to grids of analytics cards.
2. **Content is the visual focus.** Moseek itself stays predominantly monochrome.
3. **Space is intentional.** Whitespace is part of the interface.
4. **Personality is subtle.** The eye-like emblem must not make Moseek childish.
5. **Every feature must pass this test:** Does this help scattered work feel like one coherent place? If not, reconsider whether it belongs in Moseek.

## Development principle

Build one complete interaction at a time. The first prototype must eventually prove:

**Create Environment → Enter Environment → Add resources → Arrange spatially → Leave → Return → Everything remains where it was.**

Use `localStorage` for early persistence. Do not introduce Supabase until the local interaction prototype works.

> Moseek should feel less like opening project-management software and more like walking back into the room where you left your work.
