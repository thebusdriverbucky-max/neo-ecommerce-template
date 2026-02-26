// File: app/page.tsx

import { db } from "@/lib/db";
import { ProductGrid } from "@/components/shop/product-grid";
import { CTA } from "@/components/home/cta";

export const metadata = {
  title: "Home | E-Commerce Store",
  description: "Welcome to our e-commerce store",
};

export default async function HomePage() {
  const settings = await db.storeSettings.findFirst();
  const heroTitle = settings?.heroTitle || 'Welcome to Our Store';
  const heroSubtitle = settings?.heroSubtitle || 'Discover quality products at amazing prices. \nYour journey to better shopping starts here.';
  const heroButtonText = settings?.heroButtonText || 'Explore Collection ↓';

  const ctaTitle = settings?.ctaTitle || 'Ready to Shop?';
  const ctaSubtitle = settings?.ctaSubtitle || 'Browse our collection of quality products and find exactly what you need today.';
  const ctaButtonText = settings?.ctaButtonText || 'Shop Now';

  const featuredProducts = await db.product.findMany({
    where: { featured: true, isArchived: false },
    take: 12,
  });

  return (
    <div>
      {/* Hero Section */}
      <section className="relative z-10 h-[500px] bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-900 dark:to-slate-950 text-white overflow-hidden flex items-center justify-center shadow-md">

        {/* --- Геометрия фона --- */}

        {/* Огромный круг справа сверху (свечение) */}
        <div className="absolute -top-[30%] -right-[10%] w-[800px] h-[800px] bg-white/5 rounded-full blur-3xl pointer-events-none" />

        {/* Квадрат слева снизу (стеклянный эффект) */}
        <div className="absolute bottom-20 left-20 w-40 h-40 bg-white/10 backdrop-blur-sm -rotate-12 rounded-3xl border border-white/10 pointer-events-none" />

        {/* Контурный круг по центру (акцент) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-white/5 rounded-full pointer-events-none" />

        {/* Мелкие частицы */}
        <div className="absolute top-1/4 left-1/4 w-3 h-3 bg-blue-300 rounded-full blur-[1px] animate-pulse pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-2 h-2 bg-white/40 rounded-full pointer-events-none" />

        {/* --- Контент --- */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <h1 className="text-6xl font-bold mb-6 tracking-tight drop-shadow-sm">
            {heroTitle}
          </h1>
          <p className="text-2xl text-blue-100 opacity-90 max-w-2xl mx-auto leading-relaxed whitespace-pre-line">
            {heroSubtitle}
          </p>

          {/* Опционально: Кнопка действия в Hero */}
          <div className="mt-8">
            <a href="#products" className="inline-block px-8 py-3 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-full transition-all duration-300 font-medium">
              {heroButtonText}
            </a>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section id="products" className="container mx-auto px-4 py-20">
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Featured Products</h2>
          <div className="h-1 flex-1 bg-gray-100 dark:bg-gray-800 ml-8 rounded-full"></div>
        </div>
        <ProductGrid products={featuredProducts} />
      </section>

      {/* CTA Section */}
      <CTA
        title={ctaTitle}
        subtitle={ctaSubtitle}
        buttonText={ctaButtonText}
      />
    </div>
  );
}
