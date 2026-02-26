# File: README.md - PROJECT 1

# Neo Ecommerce Template

Production-ready e-commerce platform built with Next.js 14.2 LTS, Stripe, and PostgreSQL.

## Features

- **Product Management**: Catalog with filters, search, and featured products
- **Shopping Cart**: Client-side cart with Zustand state management
- **Stripe Integration**: Complete payment processing with webhook handling
- **Authentication**: NextAuth with Google and GitHub OAuth
- **Admin Dashboard**: Product and order management
- **Responsive Design**: Mobile-first approach
- **SEO Optimization**: Meta tags, sitemap, robots.txt
- **Dark Mode**: Built-in theme support

## Quick Start

### Prerequisites

- Node.js 20+ LTS
- PostgreSQL (local or Neon)
- Stripe account
- GitHub & Google OAuth credentials

### Installation

```bash
npm install
cp .env.local.example .env.local

***                                   OR 

# README.md

# E-Commerce Platform

Modern e-commerce platform built with Next.js 14, Prisma, Stripe, and NextAuth v5.

## Features

- 🛍️ Product catalog with search and filters
- 🛒 Shopping cart with persistent state
- 💳 Stripe payment integration
- 🔐 Authentication (Google OAuth + Credentials)
- 👤 User accounts and order history
- 🎨 Dark mode support
- 📱 Fully responsive design
- 🔒 Rate limiting and security features
- 📊 Admin dashboard with analytics
- 📧 Email notifications (Resend)

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL (Neon)
- **ORM:** Prisma
- **Authentication:** NextAuth v5
- **Payments:** Stripe
- **Styling:** Tailwind CSS
- **Email:** Resend
- **Rate Limiting:** Upstash Redis

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon/Supabase)
- Stripe account
- Google OAuth credentials
- Resend account

### Installation

1. Clone the repository:
\`\`\`bash
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
cd REPO_NAME
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Copy environment variables:
\`\`\`bash
cp .env.example .env.local
\`\`\`

4. Fill in your environment variables in \`.env.local\`

5. Set up the database:
\`\`\`bash
npx prisma migrate dev
npx prisma db seed
\`\`\`

6. Run the development server:
\`\`\`bash
npm run dev
\`\`\`

7. Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

See \`.env.example\` for all required environment variables.

## Deployment

### Vercel

1. Push to GitHub
2. Import project on Vercel
3. Add environment variables
4. Deploy!

Build command: \`npx prisma migrate deploy && next build\`

### Stripe Setup

See [STRIPE_SETUP.md](STRIPE_SETUP.md) for production setup instructions.

## License

MIT
