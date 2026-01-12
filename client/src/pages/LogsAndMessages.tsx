import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APP_TITLE, getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Check, CheckCheck, Clock, Loader2, MessageSquare, Send, XCircle, Search, Filter, Download } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatHistory } from "@/components/ChatHistory";
import { MessageDetailDialog } from "@/components/MessageDetailDialog";
import DashboardLayout from "@/components/DashboardLayout";

export default function LogsAndMessages() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

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

  const getStatusBadge = (status: string, readAt?: Date | null, deliveredAt?: Date | null) => {
    switch (status) {
      case "read":
        return (
          <Badge variant="default" className="bg-blue-600 gap-1">
            <CheckCheck className="w-3 h-3" />
            Read
          </Badge>
        );
      case "delivered":
        return (
          <Badge variant="default" className="bg-green-500 gap-1">
            <CheckCheck className="w-3 h-3" />
            Delivered
          </Badge>
        );
      case "sent":
        return (
          <Badge variant="default" className="bg-gray-500 gap-1">
            <Check className="w-3 h-3" />
            Sent
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="w-3 h-3" />
            Queued
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const unreadCount = messages?.filter(m => m.read === 0).length || 0;

  // Filter logs based on search and filters
  const filteredLogs = logs?.filter(log => {
    // Status filter
    if (statusFilter !== "all" && log.status !== statusFilter) {
      return false;
    }

    // Type filter
    if (typeFilter !== "all" && log.messageType !== typeFilter) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        log.customerName?.toLowerCase().includes(query) ||
        log.registration?.toLowerCase().includes(query) ||
        log.recipient?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  // Calculate statistics
  const stats = {
    total: logs?.length || 0,
    sent: logs?.filter(l => l.status === 'sent').length || 0,
    delivered: logs?.filter(l => l.status === 'delivered').length || 0,
    read: logs?.filter(l => l.status === 'read').length || 0,
    failed: logs?.filter(l => l.status === 'failed').length || 0,
  };

  // Export to CSV
  const exportToCSV = () => {
    if (!filteredLogs || filteredLogs.length === 0) return;

    const headers = ['Sent At', 'Customer', 'Vehicle', 'Type', 'Phone', 'Status', 'Delivered At', 'Read At', 'Error'];
    const rows = filteredLogs.map(log => [
      new Date(log.sentAt).toLocaleString('en-GB'),
      log.customerName || '',
      log.registration || '',
      log.messageType,
      log.recipient,
      log.status,
      log.deliveredAt ? new Date(log.deliveredAt).toLocaleString('en-GB') : '',
      log.readAt ? new Date(log.readAt).toLocaleString('en-GB') : '',
      log.errorMessage || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Group conversations by phone number, including both received messages and sent logs
  const conversationMap = new Map<string, {
    phoneNumber: string;
    messages: typeof messages;
    latestTimestamp: Date;
    latestContent: string;
    unreadCount: number;
  }>();

  // Add received messages
  messages?.forEach(message => {
    const phoneNumber = message.fromNumber;
    const existing = conversationMap.get(phoneNumber);
    const timestamp = new Date(message.receivedAt);

    if (!existing) {
      conversationMap.set(phoneNumber, {
        phoneNumber,
        messages: [message],
        latestTimestamp: timestamp,
        latestContent: message.messageBody || '',
        unreadCount: message.read === 0 ? 1 : 0,
      });
    } else {
      existing.messages?.push(message);
      if (message.read === 0) {
        existing.unreadCount++;
      }
      // Update latest if this message is newer
      if (timestamp > existing.latestTimestamp) {
        existing.latestTimestamp = timestamp;
        existing.latestContent = message.messageBody || '';
      }
    }
  });

  // Note: We intentionally do NOT include sent logs in the latest message calculation
  // The "latest message" should always be from the actual conversation (received messages)
  // This provides a better UX - users want to see the customer's latest reply, not their own sent reminders

  // Convert to array and sort by latest timestamp
  const conversations = Array.from(conversationMap.values()).sort(
    (a, b) => b.latestTimestamp.getTime() - a.latestTimestamp.getTime()
  );

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Logs & Messages</h1>
          <p className="text-muted-foreground">Track sent reminders and customer responses</p>
        </div>
        {/* Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Sent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Sent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{stats.sent}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Delivered</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.delivered}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Read</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.read}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>

        {/* Reminder Logs */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Send className="w-5 h-5" />
                  Sent Reminders Log
                </CardTitle>
                <CardDescription>
                  Track all sent WhatsApp reminders and their delivery status
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={exportToCSV} disabled={!filteredLogs || filteredLogs.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3 mt-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by customer, vehicle, or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="MOT">MOT</SelectItem>
                  <SelectItem value="Service">Service</SelectItem>
                  <SelectItem value="Custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !filteredLogs || filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{searchQuery || statusFilter !== "all" || typeFilter !== "all" ? "No matching reminders found" : "No reminders sent yet"}</p>
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Read</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow
                        key={log.id}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${log.status === 'failed' ? 'bg-red-50 dark:bg-red-950/20' : ''}`}
                        onClick={() => setSelectedLog(log)}
                      >
                        <TableCell className="font-medium text-sm whitespace-nowrap">
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
                        <TableCell className="font-mono text-sm whitespace-nowrap">{log.recipient}</TableCell>
                        <TableCell>{getStatusBadge(log.status, log.readAt, log.deliveredAt)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {log.deliveredAt ? (
                            <span className="text-green-600 dark:text-green-400">
                              {new Date(log.deliveredAt).toLocaleString("en-GB", {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {log.readAt ? (
                            <span className="text-blue-600 dark:text-blue-400">
                              {new Date(log.readAt).toLocaleString("en-GB", {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {log.errorMessage ? (
                            <div className="flex items-start gap-1 max-w-xs">
                              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-destructive line-clamp-2">{log.errorMessage}</span>
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

            {filteredLogs && filteredLogs.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground text-center">
                Showing {filteredLogs.length} of {logs?.length || 0} reminders
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
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Mark All Read
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No customer messages yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {conversations.map((conversation) => {
                  const customerData = customerDataMap.get(conversation.phoneNumber);
                  return (
                    <Dialog key={conversation.phoneNumber}>
                      <DialogTrigger asChild>
                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer transition-colors">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <MessageSquare className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium truncate">
                                  {customerData?.name || conversation.phoneNumber}
                                </p>
                                {conversation.unreadCount > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    {conversation.unreadCount}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {conversation.latestContent}
                              </p>
                              {customerData && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {customerData.registration} • {customerData.make} {customerData.model}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                            {conversation.latestTimestamp.toLocaleString("en-GB", {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh]">
                        <DialogHeader>
                          <DialogTitle>
                            Conversation with {customerData?.name || conversation.phoneNumber}
                          </DialogTitle>
                          <DialogDescription>
                            {customerData ? (
                              <span>
                                {customerData.registration} • {customerData.make} {customerData.model} • {conversation.phoneNumber}
                              </span>
                            ) : (
                              conversation.phoneNumber
                            )}
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="h-[400px] pr-4">
                          <ChatHistory
                            phoneNumber={conversation.phoneNumber}
                            customerName={customerData?.name}
                          />
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Message Detail Dialog */}
      {selectedLog && (
        <MessageDetailDialog
          open={!!selectedLog}
          onOpenChange={(open) => !open && setSelectedLog(null)}
          log={selectedLog}
        />
      )}
    </DashboardLayout>
  );
}
