'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: 'How long does shipping take?',
    answer:
      'Standard shipping takes 5-7 business days, Express takes 2-3 business days, and Overnight is delivered the next business day. Processing time is 1-2 business days before your order ships.',
  },
  {
    question: 'What is your return policy?',
    answer:
      'We offer a 30-day return guarantee on all products in original condition. Simply contact us to initiate a return. Original shipping costs are non-refundable, but we cover return shipping.',
  },
  {
    question: 'Do you offer international shipping?',
    answer:
      'Yes, we ship to Canada, select European countries, Australia, and New Zealand. International orders may incur additional customs fees.',
  },
  {
    question: 'How can I track my order?',
    answer:
      'You will receive a tracking number via email once your order ships. Use this number to track your package on the carrier website (USPS, UPS, or FedEx).',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'We accept all major credit cards (Visa, Mastercard, American Express), Apple Pay, Google Pay, and PayPal.',
  },
  {
    question: 'Is my payment information secure?',
    answer:
      'Yes. We use secure payment processing, which is PCI-DSS compliant. We never store credit card information on our servers.',
  },
  {
    question: 'Can I cancel my order?',
    answer:
      'If your order hasn\'t shipped yet, we can usually cancel it. Please contact us immediately with your order number.',
  },
  {
    question: 'How do I reset my password?',
    answer:
      'Click "Forgot Password" on the login page and enter your email. You\'ll receive a link to reset your password within minutes.',
  },
  {
    question: 'Can I modify my order after placing it?',
    answer:
      'Orders can be modified within the first 2 hours. After that, please contact us and we\'ll do our best to help.',
  },
  {
    question: 'What if I receive a damaged item?',
    answer:
      'Contact us immediately with photos of the damage and your order number. We will send a replacement or issue a full refund within 48 hours.',
  },
];

export default function FAQContent() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-4xl font-bold mb-2">Frequently Asked Questions</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Find answers to common questions about orders, shipping, returns, and more.
      </p>

      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="font-semibold text-left">{faq.question}</span>
              <ChevronDown
                className={`w-5 h-5 transition-transform ${openIndex === index ? 'rotate-180' : ''
                  }`}
              />
            </button>
            {openIndex === index && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                <p className="text-gray-700 dark:text-gray-300">{faq.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-12 p-6 bg-blue-50 dark:bg-blue-900 rounded-lg border border-blue-200 dark:border-blue-800">
        <h2 className="font-semibold mb-2">Still have questions?</h2>
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Can't find the answer you're looking for? Please contact us.
        </p>
        <a
          href="/contact"
          className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
        >
          Contact Support →
        </a>
      </div>
    </div>
  );
}
