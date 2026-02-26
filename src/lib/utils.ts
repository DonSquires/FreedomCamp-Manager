import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-NZ', {
    dateStyle: 'medium',
    timeZone: 'Pacific/Auckland',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
  }).format(new Date(date))
}

export function nzNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }))
}
