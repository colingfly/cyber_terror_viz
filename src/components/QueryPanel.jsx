import { useState } from 'react';

export default function QueryPanel({ data, onResultSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const analyzeQuery = (queryText) => {
    if (!data) return null;

    const q = queryText.toLowerCase();

    // Pattern: "which actors have multiple state sponsors"
    if (q.includes('multiple') && (q.includes('sponsor') || q.includes('backed'))) {
      const actorNodes = data.nodes.filter(n => n.type === 'actor');
      const actorsWithMultipleSponsors = [];

      actorNodes.forEach(actor => {
        const sponsorEdges = data.links.filter(l => {
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          const linkType = (l.type || '').toLowerCase();
          return targetId === actor.id && linkType.includes('sponsor_to_actor');
        });
        
        const uniqueSponsors = new Set(
          sponsorEdges.map(e => typeof e.source === 'object' ? e.source.id : e.source)
        );
        
        if (uniqueSponsors.size > 1) {
          actorsWithMultipleSponsors.push({
            actor: actor.id,
            sponsorCount: uniqueSponsors.size,
            sponsors: Array.from(uniqueSponsors),
            degree: actor.degree
          });
        }
      });

      return {
        type: 'multiple_sponsors',
        count: actorsWithMultipleSponsors.length,
        results: actorsWithMultipleSponsors.sort((a, b) => b.sponsorCount - a.sponsorCount)
      };
    }

    // Pattern: "what does [country] target most"
    const countryMatch = q.match(/what does ([\w\s]+) target/i) || q.match(/(china|russia|iran|korea)/i);
    if (countryMatch && q.includes('target')) {
      const country = countryMatch[1].trim();
      const countryVariations = {
        'china': 'China',
        'russia': 'Russian Federation',
        'iran': 'Iran (Islamic Republic of)',
        'north korea': 'Korea (Democratic People\'s Republic of)'
      };
      
      const sponsorName = countryVariations[country.toLowerCase()] || country;
      
      const targets = {};
      data.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        if (sourceId === sponsorName || 
            (sourceId && sourceId.toLowerCase().includes(country.toLowerCase()))) {
          targets[targetId] = (targets[targetId] || 0) + (link.weight || 1);
        }
      });

      const sortedTargets = Object.entries(targets)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      return {
        type: 'country_targets',
        sponsor: sponsorName,
        results: sortedTargets
      };
    }

    // Pattern: "most targeted countries/sectors"
    if (q.includes('most targeted')) {
      const targetCounts = {};
      
      data.links.forEach(link => {
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const linkType = (link.type || '').toLowerCase();
        
        if (linkType.includes('victim') || linkType.includes('target')) {
          targetCounts[targetId] = (targetCounts[targetId] || 0) + (link.weight || 1);
        }
      });

      const sortedTargets = Object.entries(targetCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, count]) => ({ name, count }));

      return {
        type: 'most_targeted',
        results: sortedTargets
      };
    }

    // Pattern: "most active sponsors/actors"
    if (q.includes('most active') && (q.includes('sponsor') || q.includes('actor'))) {
      const type = q.includes('sponsor') ? 'sponsor' : 'actor';
      const nodeCounts = {};
      
      data.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const sourceNode = data.nodes.find(n => n.id === sourceId);
        
        if (sourceNode && sourceNode.type === type) {
          nodeCounts[sourceId] = (nodeCounts[sourceId] || 0) + (link.weight || 1);
        }
      });

      const sorted = Object.entries(nodeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, count]) => ({ name, count }));

      return {
        type: 'most_active',
        category: type,
        results: sorted
      };
    }

    return { 
      type: 'unknown', 
      message: 'Query not recognized. Try: "which actors have multiple sponsors?", "what does China target most?", "most targeted countries", or "most active sponsors"' 
    };
  };

  const handleQuery = () => {
    const result = analyzeQuery(query);
    setResults(result);
  };

  return (
    <div className={`query-panel ${isOpen ? 'open' : ''}`}>
      <button className="query-toggle" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '◀ HIDE QUERY' : 'QUERY ▶'}
      </button>

      {isOpen && (
        <div className="query-content">
          <h3>NATURAL LANGUAGE QUERY</h3>
          <div className="query-input-container">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="Ask a question..."
              className="query-input"
            />
            <button onClick={handleQuery} className="query-submit">ANALYZE</button>
          </div>

          {results && results.type === 'multiple_sponsors' && (
            <div className="query-results">
              <h4>ACTORS WITH MULTIPLE STATE SPONSORS ({results.count})</h4>
              <div className="results-list">
                {results.results.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="result-item" 
                    onClick={() => onResultSelect(item.actor)}
                  >
                    <div className="result-name">{item.actor}</div>
                    <div className="result-detail">
                      {item.sponsorCount} sponsors: {item.sponsors.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.type === 'country_targets' && (
            <div className="query-results">
              <h4>{results.sponsor.toUpperCase()} - TOP TARGETS</h4>
              <div className="results-list">
                {results.results.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="result-item" 
                    onClick={() => onResultSelect(item.name)}
                  >
                    <div className="result-name">{item.name}</div>
                    <div className="result-count">{item.count} incidents</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.type === 'most_targeted' && (
            <div className="query-results">
              <h4>MOST TARGETED ENTITIES</h4>
              <div className="results-list">
                {results.results.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="result-item" 
                    onClick={() => onResultSelect(item.name)}
                  >
                    <div className="result-name">{item.name}</div>
                    <div className="result-count">{item.count} incidents</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.type === 'most_active' && (
            <div className="query-results">
              <h4>MOST ACTIVE {results.category.toUpperCase()}S</h4>
              <div className="results-list">
                {results.results.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="result-item" 
                    onClick={() => onResultSelect(item.name)}
                  >
                    <div className="result-name">{item.name}</div>
                    <div className="result-count">{item.count} incidents</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.type === 'unknown' && (
            <div className="query-results">
              <p className="error-message">{results.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}