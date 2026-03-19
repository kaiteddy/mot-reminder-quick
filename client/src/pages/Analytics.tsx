import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Mail, MessageSquare, PoundSterling } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpRight, ArrowDownRight, CircleDollarSign, FileText, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function Analytics() {
    const { data: stats, isLoading: isLoadingStats } = trpc.analytics.getStats.useQuery();
    const { data: financials, isLoading: isLoadingFinancials } = trpc.analytics.getFinancialStats.useQuery();

    if (isLoadingStats || isLoadingFinancials) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </DashboardLayout>
        );
    }
    
    const nonZeroWeeks = financials?.weeklyChartData?.filter((d: any) => d.revenue > 0) || [];
    const avgWeeklyRevenue = nonZeroWeeks.length ? nonZeroWeeks.reduce((acc: number, curr: any) => acc + curr.revenue, 0) / nonZeroWeeks.length : 0;
    
    const monthlyFiltered = (financials?.monthlyChartData || []).filter((d: any) => d.date.startsWith('2025') || d.date.startsWith('2026'));
    const nonZeroMonths = monthlyFiltered.filter((d: any) => d.revenue > 0);
    const avgMonthlyRevenue = nonZeroMonths.length ? nonZeroMonths.reduce((acc: number, curr: any) => acc + curr.revenue, 0) / nonZeroMonths.length : 0;



    if (!stats) {
        return (
            <DashboardLayout>
                <div className="text-center py-12 text-red-500">
                    Failed to load analytics data.
                </div>
            </DashboardLayout>
        )
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
                    <p className="text-muted-foreground">Comprehensive insights into business performance.</p>
                </div>

                <Tabs defaultValue="financials" className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="financials">Financial Performance</TabsTrigger>
                        <TabsTrigger value="reminders">Reminders & Cost</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="financials" className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Revenue This Week</CardTitle>
                                    <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">£{financials?.revenueThisWeek.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <div className="flex items-center text-xs text-muted-foreground">
                                        {financials?.wowChange! > 0 ? (
                                            <span className="text-green-500 font-medium flex items-center"><ArrowUpRight className="h-4 w-4 mr-1" />{financials?.wowChange.toFixed(1)}%</span>
                                        ) : (
                                            <span className="text-red-500 font-medium flex items-center"><ArrowDownRight className="h-4 w-4 mr-1" />{Math.abs(financials?.wowChange || 0).toFixed(1)}%</span>
                                        )}
                                        <span className="ml-1">from last week {financials?.wowChange! <= -50 && <span className="text-amber-600 font-semibold ml-1">(Incomplete / Pending Data)</span>}</span>
                                    </div>
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Revenue This Month</CardTitle>
                                    <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">£{financials?.revenueThisMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <div className="flex items-center text-xs text-muted-foreground">
                                        {financials?.momChange! > 0 ? (
                                            <span className="text-green-500 font-medium flex items-center"><ArrowUpRight className="h-4 w-4 mr-1" />{financials?.momChange.toFixed(1)}%</span>
                                        ) : (
                                            <span className="text-red-500 font-medium flex items-center"><ArrowDownRight className="h-4 w-4 mr-1" />{Math.abs(financials?.momChange || 0).toFixed(1)}%</span>
                                        )}
                                        <span className="ml-1">from last month {financials?.momChange! <= -50 && <span className="text-amber-600 font-semibold ml-1">(Incomplete / Pending Data)</span>}</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Revenue This Year</CardTitle>
                                    <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">£{financials?.revenueThisYear.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <div className="flex items-center text-xs text-muted-foreground">
                                        {financials?.yoyChange! > 0 ? (
                                            <span className="text-green-500 font-medium flex items-center"><ArrowUpRight className="h-4 w-4 mr-1" />{financials?.yoyChange.toFixed(1)}%</span>
                                        ) : (
                                            <span className="text-red-500 font-medium flex items-center"><ArrowDownRight className="h-4 w-4 mr-1" />{Math.abs(financials?.yoyChange || 0).toFixed(1)}%</span>
                                        )}
                                        <span className="ml-1">from last year {financials?.yoyChange! <= -50 && <span className="text-amber-600 font-semibold ml-1">(Incomplete / Pending Data)</span>}</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Lifetime Revenue</CardTitle>
                                    <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">£{financials?.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <p className="text-xs text-muted-foreground">Across all known invoices</p>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-4 mt-6">
                            {/* Ongoing Job Sheets */}
                            {financials?.jobSheets && financials.jobSheets.length > 0 && (
                                <Card className="border-amber-200 bg-amber-50/10 dark:bg-amber-950/20 dark:border-amber-900/50">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between p-6 pb-2">
                                        <div>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <div className="bg-amber-100 dark:bg-amber-900/40 p-1.5 rounded-md">
                                                    <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                                </div>
                                                Ongoing Work (Uninvoiced Job Sheets)
                                            </CardTitle>
                                            <CardDescription className="mt-1">
                                                Active job sheets currently sitting outside of finalised revenue totals.
                                            </CardDescription>
                                        </div>
                                        <div className="mt-4 md:mt-0 md:text-right flex items-center md:block gap-3">
                                            <div className="text-2xl font-bold text-amber-600 dark:text-amber-500">
                                                £{financials.jobSheetsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                            <div className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                {financials.jobSheets.length} active tickets
                                            </div>
                                        </div>
                                    </div>
                                    <CardContent>
                                        <div className="rounded-md border bg-card overflow-hidden mt-4">
                                            <Table>
                                                <TableHeader className="bg-muted/50">
                                                    <TableRow>
                                                        <TableHead className="w-[100px]">Opened</TableHead>
                                                        <TableHead className="w-[80px]">Job No</TableHead>
                                                        <TableHead className="w-[160px]">Client & Reg</TableHead>
                                                        <TableHead>Description</TableHead>
                                                        <TableHead className="text-right w-[100px]">Value</TableHead>
                                                        <TableHead className="w-[80px]"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {financials.jobSheets.slice(0, 10).map((js: any) => (
                                                        <TableRow key={js.id}>
                                                            <TableCell className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                                                {js.dateCreated ? new Date(js.dateCreated).toLocaleDateString() : 'N/A'}
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs font-medium">{js.docNo}</TableCell>
                                                            <TableCell className="py-2">
                                                                {js.registration && js.registration !== "Unknown" && js.registration !== "N/A" && (
                                                                    <span className="bg-yellow-400 text-black px-1.5 py-0.5 rounded font-mono font-bold text-[10px] border border-black shadow-sm mb-1 block w-fit tracking-wide">
                                                                        {js.registration}
                                                                    </span>
                                                                )}
                                                                <div className="text-xs font-medium truncate max-w-[140px] text-slate-700" title={js.customerName}>
                                                                    {js.customerName}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-xs max-w-[300px] truncate text-slate-600" title={js.description}>{js.description}</TableCell>
                                                            <TableCell className="text-right font-medium text-sm">
                                                                £{js.totalGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <Link href={`/generate-document?editId=${js.id}`}>
                                                                    <Button variant="ghost" size="sm" className="h-7 text-amber-700 hover:text-amber-800 hover:bg-amber-100 px-2 text-xs font-bold">
                                                                        Open <ExternalLink className="h-3 w-3 ml-1.5" />
                                                                    </Button>
                                                                </Link>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                            {financials.jobSheets.length > 10 && (
                                                <div className="text-center py-2 text-xs text-muted-foreground bg-muted/10 border-t">
                                                    Showing latest 10 of {financials.jobSheets.length} active job sheets.
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            <Card>
                                <CardHeader>
                                    <CardTitle>Weekly Revenue Trend</CardTitle>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                                        <CardDescription>Sales invoice performance over the last 52 weeks.</CardDescription>
                                        <span className="text-sm font-bold bg-primary/10 text-primary px-3 py-1 rounded-full border border-primary/20 shadow-sm">
                                            Weekly Avg (Active): £{Number(avgWeeklyRevenue).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                        </span>
                                    </div>
                                </CardHeader>
                                <CardContent className="pl-2 overflow-hidden">
                                    <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                                        <div className="h-[350px] min-w-[1000px] w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={financials?.weeklyChartData || []} margin={{ bottom: 40, right: 30 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis 
                                                    dataKey="date" 
                                                    tick={{ fontSize: 10 }} 
                                                    angle={-45}
                                                    interval={0}
                                                    height={60}
                                                    textAnchor="end"
                                                    tickFormatter={(value) => {
                                                        const [year, month, day] = value.split('-');
                                                        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                        return `${day} ${monthNames[parseInt(month)-1]}`;
                                                    }}
                                                />
                                                <YAxis 
                                                    tick={{ fontSize: 12 }} 
                                                    tickFormatter={(value) => `£${value/1000}k`}
                                                />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    formatter={(value: any) => [`£${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 'Revenue']}
                                                    labelFormatter={(label) => {
                                                         const [year, month, day] = label.split('-');
                                                         const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                         return `Week starting ${day} ${monthNames[parseInt(month)-1]} ${year}`;
                                                    }}
                                                />
                                                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                    </div>
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardHeader>
                                    <CardTitle>Yearly Revenue Trend</CardTitle>
                                    <CardDescription>Long term business growth.</CardDescription>
                                </CardHeader>
                                <CardContent className="pl-2">
                                    <div className="h-[350px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={financials?.yearlyChartData || []}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                                                <YAxis 
                                                    tick={{ fontSize: 12 }}
                                                    tickFormatter={(value) => `£${value/1000}k`}
                                                />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    formatter={(value: any) => [`£${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 'Revenue']}
                                                />
                                                <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Monthly Trend row below */}
                        <Card className="mt-4">
                            <CardHeader>
                                <CardTitle>Monthly Revenue Trend</CardTitle>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                                    <CardDescription>Performance month by month for 2025 and 2026.</CardDescription>
                                    <span className="text-sm font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full border border-amber-500/20 shadow-sm">
                                        Monthly Avg (Active): £{Number(avgMonthlyRevenue).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                    </span>
                                </div>
                            </CardHeader>
                            <CardContent className="pl-2">
                                <div className="h-[350px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={monthlyFiltered} margin={{ bottom: 40, right: 20 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis 
                                                dataKey="date" 
                                                tick={{ fontSize: 11 }} 
                                                interval={0}
                                                angle={-45}
                                                height={60}
                                                textAnchor="end"
                                                tickFormatter={(value) => {
                                                    const [year, month] = value.split('-');
                                                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                    return `${monthNames[parseInt(month)-1]} '${year.slice(2)}`;
                                                }}
                                            />
                                            <YAxis 
                                                tick={{ fontSize: 12 }} 
                                                tickFormatter={(value) => `£${value/1000}k`}
                                            />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(value: any) => [`£${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 'Revenue']}
                                                labelFormatter={(label) => {
                                                     const [year, month] = label.split('-');
                                                     const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                                                     return `${monthNames[parseInt(month)-1]} ${year}`;
                                                }}
                                            />
                                            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="reminders" className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">
                                        Total Sent
                                    </CardTitle>
                                    <Mail className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{stats.totalSent}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Reminders delivered
                                    </p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">
                                        Total Replies
                                    </CardTitle>
                                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{stats.totalReplies}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Customer responses
                                    </p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">
                                        Response Rate
                                    </CardTitle>
                                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{stats.responseRate.toFixed(1)}%</div>
                                    <p className="text-xs text-muted-foreground">
                                        Engagement ratio
                                    </p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">
                                        Est. Total Cost
                                    </CardTitle>
                                    <PoundSterling className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">£{stats.totalCost.toFixed(2)}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Based on ~£0.05/msg
                                    </p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Chart */}
                        <Card className="col-span-4 mt-4">
                            <CardHeader>
                                <CardTitle>Daily Activity (Last 30 Days)</CardTitle>
                                <CardDescription>
                                    Reminders sent vs responses received.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pl-2">
                                <div className="h-[350px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={stats.dailyStats}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis
                                                dataKey="date"
                                                tick={{ fontSize: 12 }}
                                                tickFormatter={(value) => {
                                                    const date = new Date(value);
                                                    return `${date.getDate()}/${date.getMonth() + 1}`;
                                                }}
                                            />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                labelFormatter={(label) => new Date(label).toLocaleDateString()}
                                            />
                                            <Legend />
                                            <Bar dataKey="sent" name="Sent" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="received" name="Received" fill="#10b981" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Cost Breakdown Detail */}
                        <div className="grid gap-4 md:grid-cols-2 mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Cost Breakdown</CardTitle>
                                    <CardDescription>Estimated usage costs based on message volume.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b pb-2">
                                            <span className="font-medium">Total Messages Sent</span>
                                            <span>{stats.totalSent}</span>
                                        </div>
                                        <div className="flex items-center justify-between border-b pb-2">
                                            <span className="font-medium">Estimated Cost per Message</span>
                                            <span>£0.05</span>
                                        </div>
                                        <div className="flex items-center justify-between pt-2">
                                            <span className="font-bold">Total Estimated Cost</span>
                                            <span className="font-bold text-lg">£{stats.totalCost.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Note</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">
                                        Costs are estimates only and may not reflect actual Twilio billing, which can vary by destination, message type (Template vs Session), and current exchange rates. Please check your Twilio console for exact billing.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
