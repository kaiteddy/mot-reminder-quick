import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { APP_TITLE, getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Clock, Loader2, MessageSquare, Send, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatHistory } from "@/components/ChatHistory";

export default function LogsAndMessages() {
  
  // Auto-refresh logs every 10 seconds to show updated delivery status
  const { data: logs, isLoading: logsLoading } = trpc.logs.list.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: messages, isLoading: messagesLoading } = trpc.messages.list.useQuery(undefined, {
    refetchInterval: 10000,
  });
  
  // Get unique phone numbers from messages to fetch customer data
  const uniquePhoneNumbers = Array.from(new Set(messages?.map(m => m.fromNumber) || []));
  
  // Fetch customer and vehicle info for all phone numbers in a single query
  const { data: customersData } = trpc.customers.getByPhones.useQuery(
    { phones: uniquePhoneNumbers },
    { enabled: uniquePhoneNumbers.length > 0 }
  );
  
  // Create a map of phone number to customer/vehicle data
  const customerDataMap = new Map();
  customersData?.forEach((data) => {
    if (data.phone) {
      customerDataMap.set(data.phone, data);
    }
  });
  const utils = trpc.useUtils();
  const markAsReadMutation = trpc.messages.markAsRead.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate();
      utils.messages.getUnreadCount.invalidate();
    },
  });
  const markAllAsReadMutation = trpc.messages.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate();
      utils.messages.getUnreadCount.invalidate();
    },
  });

  const isLoading = logsLoading || messagesLoading;

  if (false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Placeholder</CardTitle>
            <CardDescription>Please log in to view logs and messages</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href={getLoginUrl()}>Log In</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <Badge variant="default" className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />Delivered</Badge>;
      case "sent":
        return <Badge variant="default" className="bg-blue-500"><Send className="w-3 h-3 mr-1" />Sent</Badge>;
      case "queued":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Queued</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const unreadCount = messages?.filter(m => m.read === 0).length || 0;

  // Group messages by phone number
  const groupedMessages = messages?.reduce((acc, message) => {
    const phoneNumber = message.fromNumber;
    if (!acc[phoneNumber]) {
      acc[phoneNumber] = {
        phoneNumber,
        messages: [],
        latestMessage: message,
        unreadCount: 0,
      };
    }
    acc[phoneNumber].messages.push(message);
    if (message.read === 0) {
      acc[phoneNumber].unreadCount++;
    }
    // Update latest message if this one is newer
    if (new Date(message.receivedAt) > new Date(acc[phoneNumber].latestMessage.receivedAt)) {
      acc[phoneNumber].latestMessage = message;
    }
    return acc;
  }, {} as Record<string, { phoneNumber: string; messages: typeof messages; latestMessage: typeof messages[0]; unreadCount: number }>);

  // Convert to array and sort by latest message time
  const conversations = Object.values(groupedMessages || {}).sort(
    (a, b) => new Date(b.latestMessage.receivedAt).getTime() - new Date(a.latestMessage.receivedAt).getTime()
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{APP_TITLE}</h1>
              <p className="text-muted-foreground">Reminder Logs & Customer Messages</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/">Home</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/database">Database</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto py-8 space-y-8">
        {/* Reminder Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Sent Reminders Log
            </CardTitle>
            <CardDescription>
              Track all sent WhatsApp reminders and their delivery status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !logs || logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No reminders sent yet</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Delivered At</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id} className={log.status === 'failed' ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                        <TableCell className="font-medium text-sm">
                          {new Date(log.sentAt).toLocaleString("en-GB", {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell>{log.customerName || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{log.registration || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.messageType}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{log.recipient}</TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell className="text-sm">
                          {log.deliveredAt ? (
                            <span className="text-green-600 dark:text-green-400">
                              {new Date(log.deliveredAt).toLocaleString("en-GB", {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          ) : log.status === 'delivered' ? (
                            <span className="text-muted-foreground">Recently</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {log.errorMessage ? (
                            <div className="flex items-start gap-1">
                              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-destructive">{log.errorMessage}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Messages */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Customer Responses
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="ml-2">{unreadCount} New</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  View incoming WhatsApp messages from customers
                </CardDescription>
              </div>
              {unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markAllAsReadMutation.mutate()}
                  disabled={markAllAsReadMutation.isPending}
                >
                  {markAllAsReadMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  Mark All as Read
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !messages || messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No customer messages yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.map((conversation) => (
                  <Dialog key={conversation.phoneNumber}>
                    <DialogTrigger asChild>
                      <Card className={`cursor-pointer hover:bg-accent transition-colors ${conversation.unreadCount > 0 ? 'border-primary' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold">
                                  {customerDataMap.get(conversation.phoneNumber)?.customer?.name || conversation.phoneNumber}
                                </span>
                                {conversation.unreadCount > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    {conversation.unreadCount} New
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-xs">
                                  {conversation.messages.length} {conversation.messages.length === 1 ? 'message' : 'messages'}
                                </Badge>
                              </div>
                              
                              {/* Vehicle Information */}
                              {(() => {
                                const customerData = customerDataMap.get(conversation.phoneNumber);
                                const vehicle = customerData?.vehicles?.[0]; // Show first vehicle
                                if (vehicle) {
                                  const motExpiry = vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate) : null;
                                  const daysUntilExpiry = motExpiry ? Math.ceil((motExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                                  
                                  return (
                                    <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono font-semibold text-foreground">{vehicle.registration}</span>
                                        <span>•</span>
                                        <span>{vehicle.make} {vehicle.model}</span>
                                      </div>
                                      {motExpiry && (
                                        <div className="flex items-center gap-1">
                                          <span>MOT expires:</span>
                                          <span className={daysUntilExpiry !== null && daysUntilExpiry < 30 ? 'text-orange-600 font-medium' : ''}>
                                            {motExpiry.toLocaleDateString('en-GB')}
                                          </span>
                                          {daysUntilExpiry !== null && (
                                            <span className={daysUntilExpiry < 0 ? 'text-red-600 font-medium' : daysUntilExpiry < 30 ? 'text-orange-600 font-medium' : ''}>
                                              ({daysUntilExpiry < 0 ? `${Math.abs(daysUntilExpiry)} days ago` : `${daysUntilExpiry} days`})
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {customerData.vehicles.length > 1 && (
                                        <div className="text-blue-600">
                                          +{customerData.vehicles.length - 1} more {customerData.vehicles.length === 2 ? 'vehicle' : 'vehicles'}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {conversation.latestMessage.messageBody}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(conversation.latestMessage.receivedAt).toLocaleString("en-GB")}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[80vh]">
                      <DialogHeader>
                        <DialogTitle>Chat with {conversation.phoneNumber}</DialogTitle>
                        <DialogDescription>
                          {conversation.messages.length} {conversation.messages.length === 1 ? 'message' : 'messages'} • View conversation history and send messages
                        </DialogDescription>
                      </DialogHeader>
                      <div className="mt-4">
                        <ChatHistory
                          phoneNumber={conversation.phoneNumber}
                          customerName={conversation.phoneNumber}
                        />
                      </div>
                    </DialogContent>
                  </Dialog>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test Chat */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Test Chat
            </CardTitle>
            <CardDescription>
              Test WhatsApp messaging with +447843275372
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="max-w-2xl mx-auto">
              <ChatHistory
                phoneNumber="+447843275372"
                customerName="Test User"
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
