"use client";

import { useState, useEffect, useRef } from 'react';
import { COUNTRIES } from '@/lib/constants';
import { toCountryCode } from '@/lib/shipping';
import { availableCountries, filterCountries, resolveCountryInput, sanitizeCountryValue } from '@/lib/country-options';
import { Input } from '@/components/ui/Input';

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  /** Country names (or ISO codes in older data) from the store settings. Empty allows all. */
  enabledCountries?: string[];
}

// Always emits an ISO code, or "" while the typed text is not a country the
// customer actually picked, so a half-typed name can never be submitted.
const CountrySelect = ({ value, onChange, label, required, enabledCountries = [] }: CountrySelectProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const enabledKey = enabledCountries.join('|');

  const selectedCountry = COUNTRIES.find(c => c.code === toCountryCode(value));

  // A value that is a country name, or a country the store no longer ships to
  // (e.g. restored from an earlier visit), is normalized or cleared.
  useEffect(() => {
    if (!value) return;
    const sanitized = sanitizeCountryValue(value, enabledKey ? enabledKey.split('|') : []);
    if (sanitized !== value) onChange(sanitized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabledKey]);

  useEffect(() => {
    if (selectedCountry) {
      setSearchTerm(current => current.trim().toLowerCase() === selectedCountry.name.toLowerCase() ? current : selectedCountry.name);
    }
  }, [selectedCountry]);

  const filteredCountries = filterCountries(availableCountries(enabledCountries), searchTerm);

  const handleSelect = (countryCode: string) => {
    onChange(countryCode);
    setIsOpen(false);
    const country = COUNTRIES.find(c => c.code === countryCode);
    if (country) {
      setSearchTerm(country.name);
    }
  };

  const handleTyping = (text: string) => {
    setSearchTerm(text);
    if (!isOpen) setIsOpen(true);
    const resolved = resolveCountryInput(text, enabledCountries);
    if (resolved !== (value || '')) onChange(resolved);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [wrapperRef]);


  return (
    <div className="relative" ref={wrapperRef}>
      <label htmlFor="country-select" className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <Input
        id="country-select"
        type="text"
        value={searchTerm}
        onChange={(e) => handleTyping(e.target.value)}
        onFocus={() => setIsOpen(true)}
        required={required}
        autoComplete="off"
      />
      {isOpen && (
        <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded-md mt-1 max-h-60 overflow-y-auto">
          {filteredCountries.length > 0 ? (
            filteredCountries.map(country => (
              <li
                key={country.code}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100"
                onClick={() => handleSelect(country.code)}
              >
                {country.name}
              </li>
            ))
          ) : (
            <li className="px-4 py-2 text-gray-500">No countries found</li>
          )}
        </ul>
      )}
    </div>
  );
};

export default CountrySelect;

