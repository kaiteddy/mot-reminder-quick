import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Loader2, Check, CheckCheck, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Message {
  id: number;
  fromNumber: string;
  toNumber: string | null;
  messageBody: string;
  receivedAt: Date;
  read: number;
}

interface SentLog {
  id: number;
  recipient: string;
  templateUsed: string | null;
  sentAt: Date;
  status: string;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  registration: string | null;
  customerName: string | null;
  messageContent: string | null;
  messageType: string;
}

// Status indicator component
function MessageStatusIcon({ status }: { status: string }) {
  if (status === "read") {
    return <CheckCheck className="w-3 h-3 text-blue-500" />;
  } else if (status === "delivered") {
    return <CheckCheck className="w-3 h-3 text-gray-400" />;
  } else if (status === "sent") {
    return <Check className="w-3 h-3 text-gray-400" />;
  } else if (status === "failed") {
    return <X className="w-3 h-3 text-red-500" />;
  }
  return <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />; // queued
}

interface ChatHistoryProps {
  phoneNumber: string;
  customerName?: string;
  onClose?: () => void;
}

export function ChatHistory({ phoneNumber, customerName, onClose }: ChatHistoryProps) {
  const [testMessage, setTestMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Get all messages for this phone number (auto-refresh every 5 seconds)
  const { data: allMessages } = trpc.messages.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: allLogs } = trpc.logs.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  
  const utils = trpc.useUtils();
  
  const sendTestMessage = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("Message sent!");
      setTestMessage("");
      utils.logs.list.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });
  
  // Filter messages for this phone number
  const receivedMessages = (allMessages || []).filter(
    (msg) => msg.fromNumber === phoneNumber
  );
  
  // Filter sent logs for this phone number
  const sentMessages = (allLogs || []).filter(
    (log) => log.recipient === phoneNumber
  );
  
  // Combine and sort by timestamp
  const allConversation = [
    ...receivedMessages.map((msg) => ({
      id: `received-${msg.id}`,
      type: 'received' as const,
      message: msg.messageBody,
      timestamp: new Date(msg.receivedAt),
      status: msg.read === 1 ? 'read' : 'unread',
    })),
    ...sentMessages.map((log) => ({
      id: `sent-${log.id}`,
      type: 'sent' as const,
      message: log.messageContent || `${log.messageType} Reminder for ${log.registration || 'vehicle'}`,
      timestamp: new Date(log.sentAt),
      status: log.status,
    })),
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allConversation.length]);
  
  const handleSendTest = () => {
    if (!testMessage.trim()) {
      toast.error("Please enter a message");
      return;
    }
    
    sendTestMessage.mutate({
      id: 0, // Test message
      phoneNumber: phoneNumber,
      customMessage: testMessage,
    });
  };
  
  return (
    <div className="flex flex-col h-full max-h-[600px] w-full">
      {/* Header */}
      <div className="border-b pb-3 mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-semibold">{customerName || phoneNumber}</h3>
            <p className="text-xs text-muted-foreground">
              {phoneNumber} • {allConversation.length} messages
            </p>
          </div>
        </div>
      </div>

      {/* Message History - Scrollable */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2 min-h-[200px] max-h-[300px]"
      >
        {allConversation.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          allConversation.map((item) => (
            <div
              key={item.id}
              className={`flex ${item.type === 'sent' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-lg p-3 ${
                  item.type === 'sent'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-foreground'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{item.message}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <p className={`text-xs ${item.type === 'sent' ? 'text-blue-100' : 'text-muted-foreground'}`}>
                    {item.timestamp.toLocaleString("en-GB", {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                  {item.type === 'sent' && (
                    <MessageStatusIcon status={item.status} />
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Quick Reply Templates */}
      <div className="border-t pt-3 mb-3">
        <p className="text-xs font-medium mb-2 text-muted-foreground">Quick Replies</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setTestMessage("Thanks for confirming! We'll book you in.")}
          >
            ✓ Confirm
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const dateStr = tomorrow.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
              setTestMessage(`We have availability on ${dateStr} at 9:00 AM, 11:00 AM, or 2:00 PM. Which time works best?`);
            }}
          >
            📅 Times
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setTestMessage("Could you please confirm your vehicle registration number?")}
          >
            🚗 Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setTestMessage("Your MOT is due soon. Would you like to book an appointment?")}
          >
            ⏰ Reminder
          </Button>
        </div>
      </div>
      
      {/* Message Input */}
      <div className="border-t pt-3">
        <div className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendTest();
              }
            }}
            disabled={sendTestMessage.isPending}
            className="flex-1"
          />
          <Button
            onClick={handleSendTest}
            disabled={sendTestMessage.isPending || !testMessage.trim()}
            size="icon"
          >
            {sendTestMessage.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
