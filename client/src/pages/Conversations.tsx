import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, CheckCircle2, Clock, Eye, XCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";

export default function Conversations() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: threads, refetch: refetchThreads } = trpc.conversations.getThreads.useQuery();
  const { data: messages, refetch: refetchMessages } = trpc.conversations.getMessages.useQuery(
    { customerId: selectedCustomerId! },
    { enabled: selectedCustomerId !== null }
  );

  const markAsReadMutation = trpc.conversations.markAsRead.useMutation({
    onSuccess: () => {
      refetchThreads();
    },
  });

  const sendReplyMutation = trpc.conversations.sendReply.useMutation({
    onSuccess: () => {
      toast.success("Message sent successfully");
      setReplyMessage("");
      refetchMessages();
      refetchThreads();
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when conversation is opened
  useEffect(() => {
    if (selectedCustomerId) {
      markAsReadMutation.mutate({ customerId: selectedCustomerId });
    }
  }, [selectedCustomerId]);

  const selectedThread = threads?.find(t => t.customerId === selectedCustomerId);

  const filteredThreads = threads?.filter(thread =>
    thread.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    thread.customerPhone.includes(searchQuery) ||
    thread.vehicleRegistration?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSendReply = () => {
    if (!selectedCustomerId || !selectedThread || !replyMessage.trim()) return;

    sendReplyMutation.mutate({
      customerId: selectedCustomerId,
      phoneNumber: selectedThread.customerPhone,
      message: replyMessage.trim(),
    });
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "read":
        return <span title="Read"><Eye className="w-4 h-4 text-blue-500" /></span>;
      case "delivered":
        return <span title="Delivered"><CheckCircle2 className="w-4 h-4 text-green-500" /></span>;
      case "failed":
        return <span title="Failed"><XCircle className="w-4 h-4 text-red-500" /></span>;
      case "sent":
      case "queued":
        return <span title="Sent"><Clock className="w-4 h-4 text-gray-500" /></span>;
      default:
        return null;
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const messageDate = new Date(date);
    const diffMs = now.getTime() - messageDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return messageDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-slate-50 border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Conversations</h1>
          <p className="text-sm text-slate-600 mt-1">
            WhatsApp-style message threads with customers
          </p>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Conversation List Sidebar */}
          <div className="w-96 bg-white border-r flex flex-col">
            {/* Search */}
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Thread List */}
            <div className="flex-1 overflow-y-auto">
              {filteredThreads?.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <p className="text-sm">No conversations yet</p>
                  <p className="text-xs mt-1">Send a reminder to start a conversation</p>
                </div>
              ) : (
                filteredThreads?.map((thread) => (
                  <button
                    key={thread.customerId}
                    onClick={() => setSelectedCustomerId(thread.customerId)}
                    className={cn(
                      "w-full p-4 border-b hover:bg-slate-50 text-left transition-colors",
                      selectedCustomerId === thread.customerId && "bg-blue-50 border-l-4 border-l-blue-500"
                    )}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {thread.customerName}
                          </span>
                          {thread.unreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs px-1.5 py-0">
                              {thread.unreadCount}
                            </Badge>
                          )}
                        </div>
                        {thread.vehicleRegistration && (
                          <div className="text-xs text-slate-600 font-mono">
                            {thread.vehicleRegistration}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {getStatusIcon(thread.deliveryStatus || undefined)}
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {formatTime(thread.lastMessageAt)}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 truncate">
                      {thread.lastMessagePreview}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Conversation Detail */}
          <div className="flex-1 flex flex-col bg-slate-50">
            {selectedThread ? (
              <>
                {/* Conversation Header */}
                <div className="bg-white border-b px-6 py-4">
                  <h2 className="font-semibold text-lg text-slate-900">
                    {selectedThread.customerName}
                  </h2>
                  <div className="flex items-center gap-3 text-sm text-slate-600 mt-1">
                    <span>{selectedThread.customerPhone}</span>
                    {selectedThread.vehicleRegistration && (
                      <>
                        <span>•</span>
                        <span className="font-mono">{selectedThread.vehicleRegistration}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {messages?.map((message) => (
                    <div
                      key={`${message.type}-${message.id}`}
                      className={cn(
                        "flex",
                        message.type === "sent" ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[70%] rounded-lg px-4 py-2 shadow-sm",
                          message.type === "sent"
                            ? "bg-blue-500 text-white"
                            : "bg-white text-slate-900"
                        )}
                      >
                        {message.vehicleRegistration && (
                          <div className={cn(
                            "text-xs font-mono mb-1",
                            message.type === "sent" ? "text-blue-100" : "text-slate-500"
                          )}>
                            {message.vehicleRegistration} • {message.messageType}
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                        <div className={cn(
                          "flex items-center gap-1 mt-1 text-xs",
                          message.type === "sent" ? "text-blue-100 justify-end" : "text-slate-500"
                        )}>
                          <span>
                            {new Date(message.timestamp).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {message.type === "sent" && message.status && (
                            <span className="ml-1">{getStatusIcon(message.status)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Input */}
                <div className="bg-white border-t p-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a message..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={!replyMessage.trim() || sendReplyMutation.isPending}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Press Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <p className="text-lg font-medium">Select a conversation</p>
                  <p className="text-sm mt-1">Choose a customer from the list to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
