/**
 * Conversations backend logic
 * Groups reminder logs and customer messages into WhatsApp-style conversation threads
 */

import { getDb } from "./db";

export interface ConversationThread {
  customerId: number;
  customerName: string;
  customerPhone: string;
  vehicleRegistration: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadCount: number;
  deliveryStatus: string | null;
}

export interface ConversationMessage {
  id: number;
  type: "sent" | "received";
  content: string;
  timestamp: Date;
  status?: string; // For sent messages: sent, delivered, read, failed
  messageSid?: string;
  vehicleRegistration?: string;
  messageType?: string; // MOT, Service, etc.
}

/**
 * Get all conversation threads (customers who have been sent reminders or sent messages)
 */
export async function getConversationThreads(): Promise<ConversationThread[]> {
  const db = await getDb();
  if (!db) return [];

  const { reminderLogs, customerMessages, customers, vehicles } = await import("../drizzle/schema");
  const { sql, desc, eq, or, and, isNotNull } = await import("drizzle-orm");

  // Get all customers who have either:
  // 1. Been sent a reminder (in reminderLogs)
  // 2. Sent us a message (in customerMessages)

  // First, get customers from reminder logs
  const sentReminders = await db
    .select({
      customerId: reminderLogs.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      vehicleRegistration: vehicles.registration,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      lastMessageAt: reminderLogs.sentAt,
      lastMessagePreview: reminderLogs.messageContent,
      deliveryStatus: reminderLogs.status,
      messageSid: reminderLogs.messageSid,
    })
    .from(reminderLogs)
    .leftJoin(customers, eq(reminderLogs.customerId, customers.id))
    .leftJoin(vehicles, eq(reminderLogs.vehicleId, vehicles.id))
    .where(and(
      isNotNull(reminderLogs.customerId),
      isNotNull(reminderLogs.sentAt)
    ))
    .orderBy(desc(reminderLogs.sentAt));

  // Get customers from incoming messages
  const receivedMessages = await db
    .select({
      customerId: customerMessages.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      lastMessageAt: customerMessages.receivedAt,
      lastMessagePreview: customerMessages.messageBody,
      read: customerMessages.read,
    })
    .from(customerMessages)
    .leftJoin(customers, eq(customerMessages.customerId, customers.id))
    .where(isNotNull(customerMessages.customerId))
    .orderBy(desc(customerMessages.receivedAt));

  // Fetch all vehicles to map to customers (optimization: could be joined but this is simpler for now)
  const allVehicles = await db
    .select({
      customerId: vehicles.customerId,
      registration: vehicles.registration,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(vehicles)
    .where(isNotNull(vehicles.customerId));

  const vehicleMap = new Map<number, { registration: string, make: string | null, model: string | null }>();
  allVehicles.forEach(v => {
    if (v.customerId) {
      // Just take the first one found for now, or could prioritize
      if (!vehicleMap.has(v.customerId)) {
        vehicleMap.set(v.customerId, {
          registration: v.registration,
          make: v.make,
          model: v.model
        });
      }
    }
  });

  // Merge and group by customer
  const conversationMap = new Map<number, ConversationThread>();

  // Process sent reminders
  sentReminders.forEach(log => {
    if (!log.customerId) return;

    const existing = conversationMap.get(log.customerId);
    if (!existing || (log.lastMessageAt && log.lastMessageAt > existing.lastMessageAt)) {
      conversationMap.set(log.customerId, {
        customerId: log.customerId,
        customerName: log.customerName || "Unknown",
        customerPhone: log.customerPhone || "",
        vehicleRegistration: log.vehicleRegistration || vehicleMap.get(log.customerId)?.registration || null,
        vehicleMake: log.vehicleMake || vehicleMap.get(log.customerId)?.make || null,
        vehicleModel: log.vehicleModel || vehicleMap.get(log.customerId)?.model || null,
        lastMessageAt: log.lastMessageAt || new Date(),
        lastMessagePreview: (log.lastMessagePreview || "").substring(0, 100),
        unreadCount: 0, // Will be calculated from received messages
        deliveryStatus: log.deliveryStatus,
      });
    } else if (existing) {
      // If we found an older log that has vehicle info, and existing (newer log) doesn't, update it!
      if (!existing.vehicleRegistration && log.vehicleRegistration) {
        existing.vehicleRegistration = log.vehicleRegistration;
        existing.vehicleMake = log.vehicleMake;
        existing.vehicleModel = log.vehicleModel;
      }
    }
  });

  // Process received messages
  receivedMessages.forEach(msg => {
    if (!msg.customerId) return;

    const existing = conversationMap.get(msg.customerId);
    if (existing) {
      // Update if this message is newer
      if (msg.lastMessageAt > existing.lastMessageAt) {
        existing.lastMessageAt = msg.lastMessageAt;
        existing.lastMessagePreview = (msg.lastMessagePreview || "").substring(0, 100);
      }
      // Count unread messages
      if (msg.read === 0) {
        existing.unreadCount++;
      }
    } else {
      // Create new conversation thread from received message
      conversationMap.set(msg.customerId, {
        customerId: msg.customerId,
        customerName: msg.customerName || "Unknown",
        customerPhone: msg.customerPhone || "",
        vehicleRegistration: vehicleMap.get(msg.customerId)?.registration || null,
        vehicleMake: vehicleMap.get(msg.customerId)?.make || null,
        vehicleModel: vehicleMap.get(msg.customerId)?.model || null,
        lastMessageAt: msg.lastMessageAt,
        lastMessagePreview: (msg.lastMessagePreview || "").substring(0, 100),
        unreadCount: msg.read === 0 ? 1 : 0,
        deliveryStatus: null,
      });
    }
  });

  // Convert to array and sort by last message time
  return Array.from(conversationMap.values())
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
}

/**
 * Get full message history for a conversation with a customer
 */
export async function getConversationMessages(customerId: number): Promise<ConversationMessage[]> {
  const db = await getDb();
  if (!db) return [];

  const { reminderLogs, customerMessages, vehicles } = await import("../drizzle/schema");
  const { eq, or, desc } = await import("drizzle-orm");

  // Get sent reminders
  const sentLogs = await db
    .select({
      id: reminderLogs.id,
      content: reminderLogs.messageContent,
      timestamp: reminderLogs.sentAt,
      status: reminderLogs.status,
      messageSid: reminderLogs.messageSid,
      vehicleRegistration: vehicles.registration,
      messageType: reminderLogs.messageType,
    })
    .from(reminderLogs)
    .leftJoin(vehicles, eq(reminderLogs.vehicleId, vehicles.id))
    .where(eq(reminderLogs.customerId, customerId))
    .orderBy(reminderLogs.sentAt);

  // Get received messages
  const receivedMsgs = await db
    .select({
      id: customerMessages.id,
      content: customerMessages.messageBody,
      timestamp: customerMessages.receivedAt,
      messageSid: customerMessages.messageSid,
    })
    .from(customerMessages)
    .where(eq(customerMessages.customerId, customerId))
    .orderBy(customerMessages.receivedAt);

  // Combine and sort by timestamp
  const messages: ConversationMessage[] = [
    ...sentLogs.map(log => ({
      id: log.id,
      type: "sent" as const,
      content: log.content || "",
      timestamp: log.timestamp || new Date(),
      status: log.status || undefined,
      messageSid: log.messageSid || undefined,
      vehicleRegistration: log.vehicleRegistration || undefined,
      messageType: log.messageType || undefined,
    })),
    ...receivedMsgs.map(msg => ({
      id: msg.id,
      type: "received" as const,
      content: msg.content || "",
      timestamp: msg.timestamp,
      messageSid: msg.messageSid || undefined,
    })),
  ];

  // Sort by timestamp
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return messages;
}

/**
 * Mark all messages from a customer as read
 */
export async function markConversationAsRead(customerId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { customerMessages } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  await db
    .update(customerMessages)
    .set({ read: 1 })
    .where(eq(customerMessages.customerId, customerId));
}
