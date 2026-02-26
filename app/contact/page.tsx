'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSubmitted(true);
        setFormData({ name: '', email: '', subject: '', message: '' });
        setTimeout(() => setSubmitted(false), 5000);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-4xl font-bold mb-2">Contact Us</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Have a question? We'd love to hear from you. Send us a message and we'll get back to you as soon as possible.
      </p>

      {submitted && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-800 dark:text-green-200">
            ✓ Thank you for your message! We'll get back to you soon.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label="Name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="Your name"
          required
        />
        <Input
          label="Email"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="your@email.com"
          required
        />
        <Input
          label="Subject"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          placeholder="What is this about?"
          required
        />
        <Textarea
          label="Message"
          name="message"
          value={formData.message}
          onChange={handleChange}
          placeholder="Tell us more about your inquiry..."
          rows={6}
          required
        />
        <Button type="submit" className="w-full">
          Send Message
        </Button>
      </form>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="text-center">
          <h3 className="font-semibold mb-2">Email</h3>
          <a
            href="mailto:support@store.com"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            support@store.com
          </a>
        </div>
        <div className="text-center">
          <h3 className="font-semibold mb-2">Response Time</h3>
          <p className="text-gray-600 dark:text-gray-400">24-48 hours</p>
        </div>
        <div className="text-center">
          <h3 className="font-semibold mb-2">Hours</h3>
          <p className="text-gray-600 dark:text-gray-400">Mon-Fri, 9 AM-6 PM EST</p>
        </div>
      </div>
    </div>
  );
}
