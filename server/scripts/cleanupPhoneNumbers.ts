/**
 * Database cleanup script for phone numbers
 * Normalizes all phone numbers in customers table and extracts emails
 */

import { getDb } from '../db';
import { customers } from '../../drizzle/schema';
import { cleanPhoneField } from '../utils/phoneUtils';
import { eq } from 'drizzle-orm';

interface CleanupStats {
  total: number;
  cleaned: number;
  emailsExtracted: number;
  invalid: number;
  unchanged: number;
  errors: number;
  details: Array<{
    id: number;
    name: string;
    originalPhone: string;
    newPhone: string | null;
    extractedEmail: string | null;
    issues: string[];
  }>;
}

export async function cleanupCustomerPhoneNumbers(
  dryRun: boolean = true,
  onProgress?: (current: number, total: number, customerName: string) => void
): Promise<CleanupStats> {
  const db = await getDb();
  if (!db) {
    throw new Error('Database not available');
  }

  const stats: CleanupStats = {
    total: 0,
    cleaned: 0,
    emailsExtracted: 0,
    invalid: 0,
    unchanged: 0,
    errors: 0,
    details: [],
  };

  try {
    // Get all customers
    const allCustomers = await db.select().from(customers);
    stats.total = allCustomers.length;

    console.log(`[Phone Cleanup] Processing ${stats.total} customers...`);
    console.log(`[Phone Cleanup] Mode: ${dryRun ? 'DRY RUN (no changes will be saved)' : 'LIVE (changes will be saved)'}`);

    for (let i = 0; i < allCustomers.length; i++) {
      const customer = allCustomers[i];
      
      // Report progress
      if (onProgress) {
        onProgress(i + 1, allCustomers.length, customer.name || 'Unknown');
      }
      
      try {
        const originalPhone = customer.phone;
        
        if (!originalPhone) {
          stats.unchanged++;
          continue;
        }

        // Clean the phone number
        const { phone: cleanedPhone, email: extractedEmail, validation } = cleanPhoneField(originalPhone);

        // Check if anything changed
        const phoneChanged = cleanedPhone !== originalPhone;
        const emailExtracted = extractedEmail && extractedEmail !== customer.email;

        if (!phoneChanged && !emailExtracted) {
          stats.unchanged++;
          continue;
        }

        // Track what we're doing
        if (validation.isValid) {
          stats.cleaned++;
        } else {
          stats.invalid++;
        }

        if (emailExtracted) {
          stats.emailsExtracted++;
        }

        // Record details
        stats.details.push({
          id: customer.id,
          name: customer.name || 'Unknown',
          originalPhone,
          newPhone: cleanedPhone,
          extractedEmail,
          issues: validation.issues,
        });

        // Update database if not dry run
        if (!dryRun) {
          const updates: any = {};
          
          if (phoneChanged) {
            updates.phone = cleanedPhone;
          }
          
          // Only update email if we extracted one AND customer doesn't already have an email
          if (emailExtracted && !customer.email) {
            updates.email = extractedEmail;
          }

          if (Object.keys(updates).length > 0) {
            await db.update(customers)
              .set(updates)
              .where(eq(customers.id, customer.id));
          }
        }

      } catch (error) {
        console.error(`[Phone Cleanup] Error processing customer ${customer.id}:`, error);
        stats.errors++;
      }
    }

    // Print summary
    console.log('\n[Phone Cleanup] Summary:');
    console.log(`  Total customers: ${stats.total}`);
    console.log(`  Cleaned: ${stats.cleaned}`);
    console.log(`  Emails extracted: ${stats.emailsExtracted}`);
    console.log(`  Invalid (removed): ${stats.invalid}`);
    console.log(`  Unchanged: ${stats.unchanged}`);
    console.log(`  Errors: ${stats.errors}`);

    if (dryRun) {
      console.log('\n[Phone Cleanup] This was a DRY RUN - no changes were saved.');
      console.log('[Phone Cleanup] Run with dryRun=false to apply changes.');
    }

    return stats;

  } catch (error) {
    console.error('[Phone Cleanup] Fatal error:', error);
    throw error;
  }
}

// This module is imported by tRPC, not run directly from command line
