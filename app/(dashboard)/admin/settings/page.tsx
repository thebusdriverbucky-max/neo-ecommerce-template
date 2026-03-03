'use client';

import { useState, useEffect, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { getSettings, updateSettings, StoreSettingsData } from '@/app/actions/settings';
import { getPages, updatePage, togglePageVisibility, ContentPageData, seedCMSPages } from '@/app/actions/cms';
import { COUNTRIES as ALL_COUNTRIES, PRODUCT_CATEGORIES, DEFAULT_CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { toast } from 'sonner';
import { Edit, Eye, EyeOff, Plus, Upload } from 'lucide-react';
import { CldUploadWidget } from 'next-cloudinary';

// Hardcoded list of countries for now
const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'UA', name: 'Ukraine' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'branding' | 'cms'>('general');
  const [settings, setSettings] = useState<StoreSettingsData | null>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<any | null>(null);

  const { register, handleSubmit, setValue, watch, reset } = useForm<StoreSettingsData>();
  const cmsForm = useForm<ContentPageData>();

  const loadSettings = async () => {
    const res = await getSettings();
    if (res.success && res.data) {
      const data = res.data as unknown as StoreSettingsData;
      setSettings(data);
      setValue('storeName', data.storeName || '');
      setValue('storeEmail', data.storeEmail || '');
      setValue('currency', data.currency);
      setValue('taxRate', data.taxRate);
      setValue('shippingCost', data.shippingCost);
      setValue('enabledCountries', data.enabledCountries);
      setValue('enabledCategories', data.enabledCategories.length > 0 ? data.enabledCategories : DEFAULT_CATEGORIES);
      setValue('tiktokUrl', data.tiktokUrl || '');
      setValue('facebookUrl', data.facebookUrl || '');
      setValue('instagramUrl', data.instagramUrl || '');
      setValue('heroTitle', data.heroTitle || '');
      setValue('heroSubtitle', data.heroSubtitle || '');
      setValue('heroButtonText', data.heroButtonText || '');
      setValue('ctaTitle', data.ctaTitle || '');
      setValue('ctaSubtitle', data.ctaSubtitle || '');
      setValue('ctaButtonText', data.ctaButtonText || '');
      setValue('footerCopyright', data.footerCopyright || '');
      setValue('faviconUrl', data.faviconUrl || '');
      setValue('ogImageUrl', data.ogImageUrl || '');
      setValue('siteLang', data.siteLang || 'en');
      setValue('paymentIban', data.paymentIban || '');
      setValue('paymentBankName', data.paymentBankName || '');
      setValue('paymentAccountName', data.paymentAccountName || '');
      setValue('paymentDetails', data.paymentDetails || '');
    }
  };

  const loadPages = async () => {
    const res = await getPages();
    if (res.success && res.data) {
      setPages(res.data);
    }
  };

  useEffect(() => {
    loadSettings();
    loadPages();
  }, [setValue]);


  const onSettingsSubmit = (data: StoreSettingsData) => {
    startTransition(async () => {
      const res = await updateSettings({
        ...data,
        taxRate: Number(data.taxRate),
        shippingCost: Number(data.shippingCost),
      });
      if (res.success) {
        toast.success('Settings updated successfully');
        loadSettings();
      } else {
        toast.error('Failed to update settings');
      }
    });
  };

  const onPageSubmit = (data: ContentPageData) => {
    startTransition(async () => {
      if (!editingPage) return;

      const res = await updatePage(editingPage.id, data);

      if (res.success) {
        toast.success('Page updated');
        setIsModalOpen(false);
        setEditingPage(null);
        cmsForm.reset();
        loadPages();
      } else {
        toast.error('Failed to save page');
      }
    });
  };

  const handleEditPage = (page: any) => {
    setEditingPage(page);
    cmsForm.setValue('slug', page.slug);
    cmsForm.setValue('title', page.title);
    cmsForm.setValue('content', page.content);
    cmsForm.setValue('isVisible', page.isVisible);
    setIsModalOpen(true);
  };

  const handleToggleVisibility = async (id: string, currentVisibility: boolean) => {
    const res = await togglePageVisibility(id, !currentVisibility);
    if (res.success) {
      toast.success('Visibility updated');
      loadPages();
    } else {
      toast.error('Failed to update visibility');
    }
  };

  const selectedCountries = watch('enabledCountries') || [];
  const selectedCategories = watch('enabledCategories') || [];

  const handleCountryToggle = (code: string) => {
    const country = ALL_COUNTRIES.find(c => c.code === code);
    const countryName = country ? country.name : code;
    const current = selectedCountries;
    const updated = current.includes(countryName)
      ? current.filter((c) => c !== countryName)
      : [...current, countryName];
    setValue('enabledCountries', updated);
  };

  const handleSelectAllCountries = () => {
    setValue('enabledCountries', []);
  };

  const handleCategoryToggle = (category: string) => {
    const current = selectedCategories;
    const updated = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    setValue('enabledCategories', updated);
  };

  const handleSelectAllCategories = () => {
    if (selectedCategories.length === PRODUCT_CATEGORIES.length) {
      setValue('enabledCategories', []);
    } else {
      setValue('enabledCategories', [...PRODUCT_CATEGORIES]);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Settings</h1>

      <div className="flex space-x-4 mb-6 border-b">
        <button
          className={`pb-2 px-4 ${activeTab === 'general'
            ? 'border-b-2 border-blue-600 font-semibold text-blue-600'
            : 'text-gray-500'
            }`}
          onClick={() => setActiveTab('general')}
        >
          General Settings
        </button>
        <button
          className={`pb-2 px-4 ${activeTab === 'branding'
            ? 'border-b-2 border-blue-600 font-semibold text-blue-600'
            : 'text-gray-500'
            }`}
          onClick={() => setActiveTab('branding')}
        >
          Branding & Content
        </button>
        <button
          className={`pb-2 px-4 ${activeTab === 'cms'
            ? 'border-b-2 border-blue-600 font-semibold text-blue-600'
            : 'text-gray-500'
            }`}
          onClick={() => setActiveTab('cms')}
        >
          Content Management
        </button>
      </div>

      {activeTab === 'branding' && (
        <form onSubmit={handleSubmit(onSettingsSubmit)} className="space-y-6 bg-white p-6 rounded-lg shadow">

          {/* Hero Section */}
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              🖼️ Site Assets
              <span className="text-xs font-normal text-gray-400">(Favicon and OG Image)</span>
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Favicon URL</label>
                <div className="flex gap-2">
                  <Input
                    {...register('faviconUrl')}
                    placeholder="https://i.imgur.com/..."
                    className="flex-1"
                  />
                  <CldUploadWidget
                    uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
                    onSuccess={(result: any) => {
                      if (result.info?.secure_url) {
                        setValue('faviconUrl', result.info.secure_url);
                      }
                    }}
                  >
                    {({ open }) => (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => open()}
                        className="gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Upload
                      </Button>
                    )}
                  </CldUploadWidget>
                </div>
                <p className="text-xs text-gray-400">Recommended: 32x32 or 64x64 PNG/ICO</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Open Graph Image (OG Image)</label>
                <div className="flex gap-2">
                  <Input
                    {...register('ogImageUrl')}
                    placeholder="https://res.cloudinary.com/..."
                    className="flex-1"
                  />
                  <CldUploadWidget
                    uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
                    onSuccess={(result: any) => {
                      if (result.info?.secure_url) {
                        setValue('ogImageUrl', result.info.secure_url);
                      }
                    }}
                  >
                    {({ open }) => (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => open()}
                        className="gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Upload
                      </Button>
                    )}
                  </CldUploadWidget>
                </div>
                <p className="text-xs text-gray-400">Recommended: 1200x630 PNG/JPG for social sharing</p>
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              🏠 Hero Section
              <span className="text-xs font-normal text-gray-400">(Main banner on homepage)</span>
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Headline</label>
                <Input {...register('heroTitle')} placeholder="Discover Our Latest Collection" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subheadline</label>
                <Input {...register('heroSubtitle')} placeholder="Shop the best products at unbeatable prices" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
                <Input {...register('heroButtonText')} placeholder="Shop Now" />
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              📣 Call to Action Section
              <span className="text-xs font-normal text-gray-400">(CTA banner section)</span>
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CTA Title</label>
                <Input {...register('ctaTitle')} placeholder="Ready to Get Started?" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CTA Subtitle</label>
                <Input {...register('ctaSubtitle')} placeholder="Join thousands of satisfied customers" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CTA Button Text</label>
                <Input {...register('ctaButtonText')} placeholder="Browse Products" />
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              🦶 Footer
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Copyright Text</label>
              <Input {...register('footerCopyright')}
                placeholder="© 2026 My Store. All rights reserved." />
              <p className="text-xs text-gray-400 mt-1">
                Leave empty to use default: © {new Date().getFullYear()} {settings?.storeName || 'Store'}. All rights reserved.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Branding'}
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'general' && (
        <form onSubmit={handleSubmit(onSettingsSubmit)} className="space-y-6 bg-white p-6 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store Name</label>
              <Input {...register('storeName')} placeholder="My Awesome Store" />
              <p className="text-xs text-gray-400 mt-1">
                Displayed in emails and throughout the site
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Support Email</label>
              <Input type="email" {...register('storeEmail')} placeholder="support@mystore.com" />
              <p className="text-xs text-gray-400 mt-1">
                Used in order confirmation emails and customer support
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                {...register('currency')}
                className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Site Language (HTML lang)</label>
              <select
                {...register('siteLang')}
                className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="en">English (en)</option>
                <option value="ru">Russian (ru)</option>
                <option value="de">German (de)</option>
                <option value="fr">French (fr)</option>
                <option value="es">Spanish (es)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Sets the lang attribute of the html tag
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register('taxRate', { min: 0 })}
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Cost</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register('shippingCost', { min: 0 })}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TikTok URL</label>
              <Input {...register('tiktokUrl')} placeholder="https://tiktok.com/@yourstore" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Facebook URL</label>
              <Input {...register('facebookUrl')} placeholder="https://facebook.com/yourstore" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Instagram URL</label>
              <Input {...register('instagramUrl')} placeholder="https://instagram.com/yourstore" />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Enabled Countries</label>
                <p className="text-xs text-gray-400 mt-1">
                  No countries selected = all countries allowed at checkout.
                  Select specific countries to restrict shipping destinations.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSelectAllCountries}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Allow All Countries
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-60 overflow-y-auto border p-4 rounded-md">
              {ALL_COUNTRIES.map((country) => (
                <label key={country.code} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCountries.includes(country.name)}
                    onChange={() => handleCountryToggle(country.code)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm">{country.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Product Categories</label>
              <button
                type="button"
                onClick={handleSelectAllCategories}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {selectedCategories.length === PRODUCT_CATEGORIES.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-60 overflow-y-auto border p-4 rounded-md">
              {PRODUCT_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(category)}
                    onChange={() => handleCategoryToggle(category)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm">{category}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              💳 Payment Details (Bank Transfer)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IBAN</label>
                <Input {...register('paymentIban')} placeholder="CY00 0000 0000 0000 0000 0000 0000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                <Input {...register('paymentBankName')} placeholder="Bank of Cyprus" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder</label>
                <Input {...register('paymentAccountName')} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Details</label>
                <Textarea
                  {...register('paymentDetails')}
                  placeholder="Any extra payment info"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'cms' && (
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Pages</h2>
            <div className="flex space-x-2">
              <Button onClick={() => {
                startTransition(async () => {
                  const res = await seedCMSPages();
                  if (res.success) {
                    toast.success('Default pages seeded');
                    loadPages();
                  } else {
                    toast.error('Failed to seed pages');
                  }
                });
              }} variant="outline" size="sm">
                Seed Default Pages
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center mt-2 mb-3 md:hidden">
            ← Scroll left/right to see all actions →
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Slug
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pages.map((page) => (
                  <tr key={page.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {page.title}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{page.slug}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        onClick={() => handleToggleVisibility(page.id, page.isVisible)}
                        className={`flex items-center ${page.isVisible ? 'text-green-600' : 'text-gray-400'
                          }`}
                      >
                        {page.isVisible ? <Eye className="mr-1 h-4 w-4" /> : <EyeOff className="mr-1 h-4 w-4" />}
                        {page.isVisible ? 'Visible' : 'Hidden'}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEditPage(page)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {pages.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                      No pages found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={isModalOpen} onOpenChange={setIsModalOpen} title="Edit Page">
        <form onSubmit={cmsForm.handleSubmit(onPageSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <Input {...cmsForm.register('title', { required: true })} placeholder="Page Title" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <Input {...cmsForm.register('slug', { required: true })} placeholder="page-slug" disabled />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
            <textarea
              {...cmsForm.register('content', { required: true })}
              className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 min-h-[200px]"
              placeholder="Page content"
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              {...cmsForm.register('isVisible')}
              className="rounded text-blue-600 focus:ring-blue-500 mr-2"
            />
            <label className="text-sm font-medium text-gray-700">Visible</label>
          </div>
          <div className="flex justify-end space-x-2 mt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
