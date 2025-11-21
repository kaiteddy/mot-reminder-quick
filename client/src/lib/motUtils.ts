/**
 * MOT Date Utilities
 * Replicating GarageManager MOT date formatting logic
 */

export interface MOTDateInfo {
  date: string;
  isExpired: boolean;
  daysUntilExpiry: number;
}

export function formatMOTDate(motExpiry: string | Date | null): MOTDateInfo | string {
  if (!motExpiry) return "No MOT Data";

  const motDate = new Date(motExpiry);
  const today = new Date();
  
  // Reset time to midnight for accurate day calculation
  motDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const isExpired = motDate < today;
  const daysUntilExpiry = Math.ceil((motDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return {
    date: motDate.toLocaleDateString('en-GB'),
    isExpired,
    daysUntilExpiry
  };
}

export function getMOTStatusBadge(motInfo: MOTDateInfo | string): {
  variant: "default" | "destructive" | "outline" | "secondary";
  text: string;
  className?: string;
} {
  if (typeof motInfo === 'string') {
    return {
      variant: "secondary",
      text: "No MOT Data"
    };
  }

  if (motInfo.isExpired) {
    return {
      variant: "destructive",
      text: "Expired"
    };
  }

  if (motInfo.daysUntilExpiry <= 30) {
    return {
      variant: "outline",
      text: "Due Soon",
      className: "border-orange-500 text-orange-600"
    };
  }

  return {
    variant: "default",
    text: "Valid",
    className: "bg-green-500"
  };
}

export function formatDaysUntilExpiry(days: number): string {
  if (days < 0) {
    return `Expired ${Math.abs(days)} days ago`;
  }
  if (days === 0) {
    return "Expires today";
  }
  if (days === 1) {
    return "Expires tomorrow";
  }
  return `${days} days until expiry`;
}
