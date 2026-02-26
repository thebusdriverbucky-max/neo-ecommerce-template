"use client";

import { useState, useEffect, useRef } from 'react';
import { COUNTRIES } from '@/lib/constants';
import { Input } from '@/components/ui/Input';

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  enabledCountries?: string[];
}

const CountrySelect = ({ value, onChange, label, required, enabledCountries = [] }: CountrySelectProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedCountry = COUNTRIES.find(c => c.code === value);

  useEffect(() => {
    if (selectedCountry) {
      setSearchTerm(selectedCountry.name);
    }
  }, [selectedCountry]);

  const availableCountries = enabledCountries.length > 0
    ? COUNTRIES.filter(c => enabledCountries.includes(c.name) || enabledCountries.includes(c.code))
    : COUNTRIES;

  const filteredCountries = availableCountries.filter(country =>
    country.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (countryCode: string) => {
    onChange(countryCode);
    setIsOpen(false);
    const country = COUNTRIES.find(c => c.code === countryCode);
    if (country) {
      setSearchTerm(country.name);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectedCountry) {
          setSearchTerm(selectedCountry.name);
        } else {
          setSearchTerm('');
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [wrapperRef, selectedCountry]);


  return (
    <div className="relative" ref={wrapperRef}>
      <label htmlFor="country-select" className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <Input
        id="country-select"
        type="text"
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
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

