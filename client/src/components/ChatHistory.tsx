import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Loader2 } from "lucide-react";
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
  registration: string | null;
  customerName: string | null;
}

interface ChatHistoryProps {
  phoneNumber: string;
  customerName?: string;
  onClose?: () => void;
}

export function ChatHistory({ phoneNumber, customerName, onClose }: ChatHistoryProps) {
  const [testMessage, setTestMessage] = useState("");
  
  // Get all messages for this phone number
  const { data: allMessages } = trpc.messages.list.useQuery();
  const { data: allLogs } = trpc.logs.list.useQuery();
  
  const utils = trpc.useUtils();
  
  const sendTestMessage = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("Test message sent!");
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
      message: `MOT Reminder for ${log.registration || 'vehicle'}`,
      timestamp: new Date(log.sentAt),
      status: log.status,
    })),
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  const handleSendTest = () => {
    if (!testMessage.trim()) {
      toast.error("Please enter a message");
      return;
    }
    
    sendTestMessage.mutate({
      id: 0, // Test message
      phoneNumber: phoneNumber,
    });
  };
  
  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Chat with {customerName || phoneNumber}
        </CardTitle>
        <CardDescription>
          {phoneNumber} • {allConversation.length} messages
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Message History */}
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {allConversation.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No messages yet</p>
              </div>
            ) : (
              allConversation.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${item.type === 'sent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      item.type === 'sent'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{item.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs opacity-70">
                        {item.timestamp.toLocaleString("en-GB", {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                      {item.type === 'sent' && (
                        <Badge variant="outline" className="text-xs h-4 px-1">
                          {item.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        
        {/* Test Message Input */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-2">Send Test Message</p>
          <div className="flex gap-2">
            <Input
              placeholder="Type a test message..."
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendTest();
                }
              }}
              disabled={sendTestMessage.isPending}
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
      </CardContent>
    </Card>
  );
}
