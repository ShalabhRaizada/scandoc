import { useState, useEffect } from 'react';

interface ReportStats {
  total_documents: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost: number;
  average_cost_per_document: number;
}

export default function CostReport() {
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSessionToken = () => localStorage.getItem('scandoc_session') || '';

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3001/api/reports/token-usage', {
        headers: {
          'Authorization': `Bearer ${getSessionToken()}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch reporting statistics.');
      }
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatCost = (num: number) => {
    if (num === 0) return '$0.00';
    // Return high precision if cost is very small
    if (num < 0.01) {
      return '$' + num.toFixed(6);
    }
    return '$' + num.toFixed(4);
  };

  const formatTokens = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const promptPercent = stats && stats.total_tokens > 0 
    ? Math.round((stats.total_prompt_tokens / stats.total_tokens) * 100)
    : 0;

  const completionPercent = stats && stats.total_tokens > 0 
    ? Math.round((stats.total_completion_tokens / stats.total_tokens) * 100)
    : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h2 style={{ fontSize: '1.75rem', margin: 0, color: '#fff' }}>Token & Cost Report</h2>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="action-btn"
          style={{ padding: '8px 16px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          🔄 {loading ? 'Refreshing...' : 'Refresh Statistics'}
        </button>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
        Real-time monitoring of tokens consumed, total expenses, and average cost per document for the Gemini API.
      </p>

      {error && (
        <div className="glass-panel" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171', marginBottom: '20px' }}>
          ⚠️ {error}
        </div>
      )}

      {loading && !stats ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span className="spinner" style={{ fontSize: '2rem' }}>⚡</span>
          <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>Loading reports data...</p>
        </div>
      ) : stats ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Top Row Grid Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            
            {/* Card 1: Documents Scanned */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Documents Ingested
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff', marginTop: '12px', letterSpacing: '-0.025em' }}>
                {stats.total_documents}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '8px' }}>
                📁 Total documents processed
              </div>
            </div>

            {/* Card 2: Total Tokens */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total Tokens Consumed
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff', marginTop: '12px', letterSpacing: '-0.025em' }}>
                {formatTokens(stats.total_tokens)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#818cf8', marginTop: '8px' }}>
                🧠 prompt + candidates response
              </div>
            </div>

            {/* Card 3: Total Cost */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total Cost Incurred
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#10b981', marginTop: '12px', letterSpacing: '-0.025em' }}>
                {formatCost(stats.total_cost)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(16,185,129,0.7)', marginTop: '8px' }}>
                💵 Calculated at standard API rates
              </div>
            </div>

            {/* Card 4: Avg Cost per Document */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Avg Cost / Document
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fbbf24', marginTop: '12px', letterSpacing: '-0.025em' }}>
                {formatCost(stats.average_cost_per_document)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(251,191,36,0.7)', marginTop: '8px' }}>
                📈 average scan unit expense
              </div>
            </div>

          </div>

          {/* Detailed Token Splits */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'stretch' }}>
            
            {/* Input vs Output splits */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '1.25rem', color: '#fff' }}>Token Consumption Breakdown</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* Prompt Tokens */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Input (Prompt) Tokens</span>
                    <span style={{ fontWeight: 600, color: '#fff' }}>{formatTokens(stats.total_prompt_tokens)} ({promptPercent}%)</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${promptPercent}%`, height: '100%', background: '#6366f1', borderRadius: '4px' }} />
                  </div>
                </div>

                {/* Completion Tokens */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Output (Completion) Tokens</span>
                    <span style={{ fontWeight: 600, color: '#fff' }}>{formatTokens(stats.total_completion_tokens)} ({completionPercent}%)</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${completionPercent}%`, height: '100%', background: '#10b981', borderRadius: '4px' }} />
                  </div>
                </div>

              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                ℹ️ Prompt tokens consist of the AI model system instructions and image/PDF file payloads. Output tokens are the structured JSON values generated by the model.
              </div>
            </div>

            {/* Model Rate Card */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '1.25rem', color: '#fff' }}>Model Pricing Reference</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '12px' }}>
                  <span>Gemini 3.5 Flash Input Rate</span>
                  <span style={{ fontWeight: 600, color: '#fff' }}>$0.075 / 1,000,000 tokens</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '12px' }}>
                  <span>Gemini 3.5 Flash Output Rate</span>
                  <span style={{ fontWeight: 600, color: '#fff' }}>$0.300 / 1,000,000 tokens</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '4px' }}>
                  <span>Mock Extractor Mode Rate</span>
                  <span style={{ fontWeight: 600, color: '#34d399' }}>Free / 0 real cost</span>
                </div>
              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                💡 While using the **Mock Fallback Simulation Mode**, we calculate realistic simulated tokens (1200-1500 prompt, 300-500 completion) to ensure you can test this dashboard and budget your expenses realistically before launching real API keys.
              </div>
            </div>

          </div>

        </div>
      ) : null}
    </div>
  );
}
