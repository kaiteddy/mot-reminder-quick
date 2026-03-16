import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Activity } from "lucide-react";

interface MOTTest {
  completedDate: string;
  testResult: string;
  odometerValue?: string;
  odometerUnit?: string;
}

interface MOTMileageChartProps {
  tests: MOTTest[];
}

export function MOTMileageChart({ tests }: MOTMileageChartProps) {
  const chartData = useMemo(() => {
    if (!tests || tests.length === 0) return [];

    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

    // Filter tests that have valid numeric odometers and were done within the last 10 years
    const validTests = tests.filter(test => {
      const isDateValid = new Date(test.completedDate).getTime() >= tenYearsAgo.getTime();
      const hasOdometer = test.odometerValue && !isNaN(Number(test.odometerValue));
      return isDateValid && hasOdometer;
    });

    if (validTests.length === 0) return [];

    // Sort chronologically (oldest to newest)
    const sortedTests = [...validTests].sort((a, b) => {
      return new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime();
    });

    // We may have multiple tests in a single year. Optionally we can pick the highest mileage per year or just map points.
    // Let's just track every test chronologically but show the year.
    let previousMileage = 0;
    
    return sortedTests.map((t, index) => {
      const date = new Date(t.completedDate);
      const mileage = parseInt(t.odometerValue || "0", 10);
      let annualChange = 0;

      if (index > 0 && previousMileage > 0) {
        // Calculate diff. Sometimes odometers are entered wrong (e.g. drop a digit) so diff can be negative
        annualChange = mileage - previousMileage;
      }
      
      previousMileage = mileage;

      return {
        dateString: date.toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
        timestamp: date.getTime(),
        mileage: mileage,
        annualUse: annualChange > 0 && annualChange < 100000 ? annualChange : null, // Filters out crazy typos
        unit: t.odometerUnit === "km" ? "km" : "mi"
      };
    });
  }, [tests]);

  if (chartData.length < 2) {
    return null; // Don't show chart if we don't have enough data points to plot a line
  }

  // Calculate some quick stats based on chronological data
  const latest = chartData[chartData.length - 1];
  const earliest = chartData[0];
  const yearsDiff = (latest.timestamp - earliest.timestamp) / (1000 * 60 * 60 * 24 * 365.25);
  const totalDifference = latest.mileage - earliest.mileage;
  
  const avgAnnual = yearsDiff >= 1 && totalDifference > 0 
    ? Math.round(totalDifference / yearsDiff) 
    : 0;

  return (
    <Card className="mb-6 border-slate-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-blue-600" />
              10-Year Mileage History
            </CardTitle>
            <CardDescription>
              Vehicle usage tracking over time based on MOT records
            </CardDescription>
          </div>
          {avgAnnual > 0 && (
            <div className="text-right">
              <div className="text-2xl font-bold flex items-center justify-end gap-1 text-slate-800">
                {avgAnnual.toLocaleString()} <span className="text-sm font-normal text-slate-500">{latest.unit}/yr</span>
              </div>
              <div className="text-xs text-slate-500 font-medium">Average Annual Usage</div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div 
          className="h-[250px] mt-4" 
          style={{ 
            width: "100%", 
            maxWidth: chartData.length <= 4 ? `${Math.max(chartData.length * 180, 400)}px` : "100%" 
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMileage" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis 
                dataKey="dateString" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                dy={10}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={(val) => {
                  if (val >= 1000) return `${Math.round(val / 1000)}k`;
                  return val;
                }}
              />
              <Tooltip 
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border shadow-lg rounded-lg p-3 text-sm">
                        <div className="font-bold text-slate-800 mb-1">{label}</div>
                        <div className="flex justify-between gap-4">
                          <span className="text-slate-500">Odometer:</span>
                          <span className="font-semibold">{data.mileage.toLocaleString()} {data.unit}</span>
                        </div>
                        {data.annualUse !== null && data.annualUse > 0 && (
                          <div className="flex justify-between gap-4 mt-1">
                            <span className="text-slate-500">Delta:</span>
                            <span className="font-semibold text-blue-600">+{data.annualUse.toLocaleString()} {data.unit}</span>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area 
                type="monotone" 
                dataKey="mileage" 
                stroke="#3b82f6" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorMileage)" 
                activeDot={{ r: 6, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
