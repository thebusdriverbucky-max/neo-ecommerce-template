// File: components/home/cta.tsx

import Link from "next/link";

interface CTAProps {
  title?: string;
  subtitle?: string;
  buttonText?: string;
}

export function CTA({ 
  title = "Ready to Shop?", 
  subtitle = "Browse our collection of quality products and find exactly what you need today.", 
  buttonText = "Shop Now" 
}: CTAProps) {
  return (
    <section className="relative bg-blue-600 dark:bg-blue-900 text-white pt-24 pb-0 overflow-hidden">
      {/* --- Геометрический фон --- */}

      {/* Большой круг слева сверху */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />

      {/* Четкий круг справа снизу */}
      <div className="absolute bottom-32 -right-12 w-80 h-80 border-[40px] border-white/5 rounded-full pointer-events-none" />

      {/* Повернутый квадрат по центру */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-white/10 rotate-45 rounded-[3rem] pointer-events-none" />

      {/* Маленькие декоративные элементы */}
      <div className="absolute top-20 right-20 w-4 h-4 bg-white/30 rounded-full pointer-events-none" />
      <div className="absolute bottom-40 left-20 w-6 h-6 bg-white/20 rotate-45 rounded pointer-events-none" />

      {/* --- Контент --- */}
      <div className="relative container mx-auto px-4 text-center z-10 pb-32">
        <h2 className="text-4xl font-bold mb-6 tracking-tight">
          {title}
        </h2>
        <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
          {subtitle}
        </p>
        <Link
          href="/products"
          className="inline-block px-8 py-4 bg-white text-blue-600 font-bold rounded-xl shadow-lg hover:bg-blue-50 hover:scale-105 transition-all duration-200"
        >
          {buttonText}
        </Link>
      </div>

      {/* --- Адаптивная волна --- */}
      <div className="absolute bottom-0 left-0 w-full overflow-hidden leading-none">
        {/* Мобильная версия: простая волна БЕЗ переворота */}
        <svg
          className="relative block w-full h-[80px] md:hidden"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
        >
          <path
            d="M0,96L1440,160L1440,320L0,320Z"
            className="fill-gray-800 dark:fill-gray-950"
          />
        </svg>

        {/* Десктоп версия: красивая волнистая С переворотом */}
        <svg
          className="hidden md:block relative w-full h-[120px] scale-y-[-1]"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path
            d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V0H0V27.35A600.21,600.21,0,0,0,321.39,56.44Z"
            className="fill-gray-800 dark:fill-gray-950"
          />
        </svg>
      </div>
    </section>
  );
}
