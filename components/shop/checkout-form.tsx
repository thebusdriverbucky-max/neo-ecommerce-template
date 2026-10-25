// File: components/shop/checkout-form.tsx

"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addressSchema } from "@/lib/validations";
import CountrySelect from "@/components/ui/CountrySelect";
import { useSettings } from "@/components/providers/settings-provider";
import { isCountryEnabled, toCountryCode } from "@/lib/shipping";
import { sanitizeCountryValue } from "@/lib/country-options";
import { z } from "zod";

interface CheckoutFormProps {
  onSubmit: (data: any) => void;
  loading: boolean;
}

type AddressFormValues = z.input<typeof addressSchema>;

const COUNTRIES_WITH_REQUIRED_STATE = ['US', 'CA', 'AU', 'IN'];

export function CheckoutForm({ onSubmit, loading }: CheckoutFormProps) {
  const { settings } = useSettings();
  const enabledCountries = settings?.enabledCountries || [];

  const { register, handleSubmit, watch, setValue, setError, reset, formState: { errors } } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
  });

  // Load saved form data from localStorage
  useEffect(() => {
    const savedData = localStorage.getItem("checkout-form-data");
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        // The store may have stopped shipping to the saved country since then.
        reset({ ...parsedData, country: sanitizeCountryValue(parsedData?.country, enabledCountries) });
      } catch (e) {
        console.error("Failed to parse saved checkout data", e);
      }
    }
    // Only the initial restore: later settings changes are handled by CountrySelect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset]);

  // CountrySelect is not a native input, so the field is registered by hand.
  useEffect(() => { register("country"); }, [register]);

  // Watch all form changes and save to localStorage
  const formData = watch();
  useEffect(() => {
    if (Object.keys(formData).length > 0) {
      localStorage.setItem("checkout-form-data", JSON.stringify(formData));
    }
  }, [formData]);

  const countryValue = watch("country");

  const onFormSubmit = (data: any) => {
    if (!isCountryEnabled(data.country, enabledCountries)) {
      setError("country", { type: "validate", message: "We do not ship to this country" });
      return;
    }
    localStorage.removeItem("checkout-form-data");
    onSubmit({ shippingAddress: { ...data, country: toCountryCode(data.country) } });
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      <div>
        <h3 className="text-lg font-bold mb-4">Shipping Address</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <input
                {...register("firstName")}
                placeholder="First Name"
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.firstName ? 'border-red-500' : 'border-gray-300'}`}
              />
              {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName.message as string}</p>}
            </div>
            <div>
              <input
                {...register("lastName")}
                placeholder="Last Name"
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.lastName ? 'border-red-500' : 'border-gray-300'}`}
              />
              {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName.message as string}</p>}
            </div>
          </div>

          <input
            {...register("email")}
            type="email"
            placeholder="Email"
            className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.email ? 'border-red-500' : 'border-gray-300'}`}
          />
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message as string}</p>}

          <input
            {...register("phone")}
            placeholder="Phone"
            className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.phone ? 'border-red-500' : 'border-gray-300'}`}
          />
          {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message as string}</p>}

          <input
            {...register("street")}
            placeholder="Street Address"
            className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.street ? 'border-red-500' : 'border-gray-300'}`}
          />
          {errors.street && <p className="text-red-500 text-xs mt-1">{errors.street.message as string}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <input
                {...register("city")}
                placeholder="City"
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.city ? 'border-red-500' : 'border-gray-300'}`}
              />
              {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message as string}</p>}
            </div>
            <div>
              <input
                {...register("postalCode")}
                placeholder="Postal Code"
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.postalCode ? 'border-red-500' : 'border-gray-300'}`}
              />
              {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode.message as string}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <CountrySelect
                label="Country"
                value={countryValue ?? ""}
                onChange={(value) => setValue("country", value, {
                  // Stay quiet while the first letters are typed; flag a cleared pick.
                  shouldValidate: value !== "" || Boolean(countryValue) || Boolean(errors.country),
                })}
                enabledCountries={enabledCountries}
                required
              />
              {errors.country && <p className="text-red-500 text-xs mt-1">{errors.country.message as string}</p>}
            </div>
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
              <input
                id="state"
                {...register("state")}
                placeholder="State/Province"
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 ${errors.state ? 'border-red-500' : 'border-gray-300'}`}
              />
              {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state.message as string}</p>}
            </div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Processing..." : "Place Order"}
      </button>
    </form>
  );
}
