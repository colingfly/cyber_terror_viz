import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function NodeDetailPanel({ node, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (!node) return;
    setLoading(true);
    fetch('/node_details.json')
      .then(res => res.json())
      .then(data => {
        const key = String(node.id).replace(/\s*\[(S|T)\]$/i, '');
        const foundDetails = data[key] || data[node.id] || null;
        
        if (!foundDetails) {
          console.warn(`No details found for node: ${node.id} (tried key: ${key})`);
        }
        
        setDetails(foundDetails);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load node details:', err);
        setLoading(false);
      });
  }, [node]);

  const kvToSortedArr = (obj) => {
    if (!obj) return [];
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({
        name: name.length > 28 ? name.slice(0, 28) + '…' : name,
        count
      }));
  };

  const getChartData = () => {
    if (!details) return { chart1: [], chart2: [] };
    
    if (node.type === 'sponsor') {
      return {
        chart1: kvToSortedArr(details.targets),
        chart1Label: 'THREAT ACTORS SPONSORED',
        chart2: kvToSortedArr(details.sources),
        chart2Label: 'ALSO BACKED BY'
      };
    }
    
    if (node.type === 'actor') {
      return {
        chart1: kvToSortedArr(details.targets),
        chart1Label: 'TOP TARGETS ATTACKED',
        chart2: kvToSortedArr(details.sources),
        chart2Label: 'SPONSORED BY'
      };
    }
    
    if (node.type === 'victim') {
      return {
        chart1: kvToSortedArr(details.sources),
        chart1Label: 'ATTACKED BY',
        chart2: kvToSortedArr(details.actors || {}),
        chart2Label: 'THREAT ACTORS USED'
      };
    }
    
    return {
      chart1: kvToSortedArr(details.targets),
      chart1Label: 'RELATED ENTITIES',
      chart2: kvToSortedArr(details.sources),
      chart2Label: 'CONNECTED TO'
    };
  };

  const chartData = getChartData();

  // Keep both charts aligned by using a shared Y-axis width derived from the longest rendered label.
  const getYAxisWidth = (datasets) => {
    const maxLen = (datasets || []).reduce((m, arr) => {
      if (!arr || !arr.length) return m;
      const ml = arr.reduce((mm, it) => Math.max(mm, (it.name || '').length), 0);
      return Math.max(m, ml);
    }, 0);
    return Math.min(160, Math.max(75, Math.round(maxLen * 7))); // ~7px per char, clamped
  };

  const yAxisWidth = getYAxisWidth([chartData.chart1, chartData.chart2]);
  const chartMargins = { top: 8, right: 14, bottom: 8, left: 14 };

  return (
    <div className={`node-detail-panel ${isMinimized ? 'minimized' : ''}`}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-label">NODE ANALYSIS</div>
          <h2>{node.id}</h2>
        </div>
        <div className="panel-actions">
          <button 
            className="panel-minimize" 
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? "Expand" : "Minimize"}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button className="panel-close" onClick={onClose}>×</button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="panel-meta">
            <div>
              <span>TYPE</span>
              <strong>{(node.type || '—').toUpperCase()}</strong>
            </div>
            <div>
              <span>TOTAL INCIDENTS</span>
              <strong>{details?.total_incidents ?? '—'}</strong>
            </div>
            <div>
              <span>CONNECTIONS</span>
              <strong>{node.degree ?? '—'}</strong>
            </div>
          </div>

          {!loading && (chartData.chart1.length > 0 || chartData.chart2.length > 0) && (
            <div className="panel-charts">
              {chartData.chart1.length > 0 && (
                <div className="chart-block">
                  <div className="chart-title">{chartData.chart1Label}</div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={chartData.chart1} layout="vertical" margin={chartMargins}>
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9AA8B7' }} />
                        <YAxis type="category" dataKey="name" width={yAxisWidth} tick={{ fontSize: 11, fill: '#D8E1EA' }} />
                        <Tooltip 
                          contentStyle={{ background: '#0C1117', border: '1px solid #2A3746', fontSize: 11 }} 
                          cursor={{ fill: 'rgba(121, 166, 255, 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#6FA7FF" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {chartData.chart2.length > 0 && (
                <div className="chart-block">
                  <div className="chart-title">{chartData.chart2Label}</div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={chartData.chart2} layout="vertical" margin={chartMargins}>
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9AA8B7' }} />
                        <YAxis type="category" dataKey="name" width={yAxisWidth} tick={{ fontSize: 11, fill: '#D8E1EA' }} />
                        <Tooltip 
                          contentStyle={{ background: '#0C1117', border: '1px solid #2A3746', fontSize: 11 }}
                          cursor={{ fill: 'rgba(121, 166, 255, 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#E0555A" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && chartData.chart1.length === 0 && chartData.chart2.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#9AA8B7' }}>
              No detailed data available for this node
            </div>
          )}

          {loading && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#9AA8B7' }}>
              Loading details...
            </div>
          )}
        </>
      )}
    </div>
  );
}
