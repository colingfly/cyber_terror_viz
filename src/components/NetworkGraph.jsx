import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import NodeDetailPanel from './NodeDetailPanel';

export default function NetworkGraph() {
  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const svgSelRef = useRef(null);

  const [data, setData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [networkType, setNetworkType] = useState('sector');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // -------- GEO role normalization (FIXED v2) --------
  function normalizeGeo(networkData) {
    console.log('Starting normalizeGeo...');
    
    // First pass: normalize links to string IDs
    const links = (networkData.links || []).map(l => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      weight: l.weight ?? 1,
      type: l.type || ''
    }));

    // Collect all node IDs mentioned in links
    const allNodeIds = new Set();
    links.forEach(l => {
      allNodeIds.add(l.source);
      allNodeIds.add(l.target);
    });

    // Build base nodes map
    const nodesById = new Map();
    (networkData.nodes || []).forEach(n => {
      nodesById.set(n.id, { ...n });
    });

    // Add any nodes referenced in links but missing from nodes array
    allNodeIds.forEach(id => {
      if (!nodesById.has(id)) {
        console.warn(`Node "${id}" referenced in links but not in nodes - adding it`);
        nodesById.set(id, { id, type: 'actor', degree: 0 });
      }
    });

    // Detect sponsors/victims roles by edge type for EACH LINK
    const linkRoles = links.map(l => {
      const t = String(l.type).toLowerCase();
      return {
        link: l,
        sourceRole: t.includes('sponsor_to') ? 'sponsor' : 'actor',
        targetRole: (t.includes('_to_victim') || t.includes('to_victim')) ? 'victim' : 'actor'
      };
    });

    // Aggregate roles per node
    const nodeRoles = new Map();
    linkRoles.forEach(({ link, sourceRole, targetRole }) => {
      // Track source roles
      const sourceRoleSet = nodeRoles.get(link.source) || new Set();
      sourceRoleSet.add(sourceRole);
      nodeRoles.set(link.source, sourceRoleSet);
      
      // Track target roles
      const targetRoleSet = nodeRoles.get(link.target) || new Set();
      targetRoleSet.add(targetRole);
      nodeRoles.set(link.target, targetRoleSet);
    });

    // Find nodes that need splitting (both sponsor AND victim)
    const needsSplit = new Set();
    nodeRoles.forEach((roles, nodeId) => {
      if (roles.has('sponsor') && roles.has('victim')) {
        console.log(`Node "${nodeId}" needs splitting (has both sponsor and victim roles)`);
        needsSplit.add(nodeId);
      }
    });

    // Create mapping for split nodes with fallback
    const getNodeId = (originalId, role) => {
      if (!needsSplit.has(originalId)) {
        return originalId;
      }
      // For split nodes, map based on role
      if (role === 'sponsor') return `${originalId} [S]`;
      if (role === 'victim') return `${originalId} [T]`;
      // Fallback: if role is ambiguous (actor), use sponsor version for consistency
      console.warn(`Ambiguous role 'actor' for split node "${originalId}", defaulting to [S]`);
      return `${originalId} [S]`;
    };

    // Build new nodes
    const newNodes = [];
    nodesById.forEach((node, nodeId) => {
      if (needsSplit.has(nodeId)) {
        newNodes.push({ id: `${nodeId} [S]`, type: 'sponsor', degree: 0 });
        newNodes.push({ id: `${nodeId} [T]`, type: 'victim', degree: 0 });
      } else {
        const roles = nodeRoles.get(nodeId);
        let nodeType = node.type || 'actor';
        if (roles) {
          if (roles.has('sponsor')) nodeType = 'sponsor';
          else if (roles.has('victim')) nodeType = 'victim';
        }
        newNodes.push({ id: nodeId, type: nodeType, degree: 0 });
      }
    });

    // Rewire ALL links using role-based mapping
    const newLinks = linkRoles.map(({ link, sourceRole, targetRole }) => {
      const newSource = getNodeId(link.source, sourceRole);
      const newTarget = getNodeId(link.target, targetRole);
      return { 
        source: newSource, 
        target: newTarget, 
        weight: link.weight, 
        type: link.type 
      };
    });

    // Verify all links point to valid nodes
    const newNodeIds = new Set(newNodes.map(n => n.id));
    const invalidLinks = newLinks.filter(l => 
      !newNodeIds.has(l.source) || !newNodeIds.has(l.target)
    );
    
    if (invalidLinks.length > 0) {
      console.error('Found invalid links after normalization:', invalidLinks);
      console.error('Details of first invalid link:');
      const firstInvalid = invalidLinks[0];
      console.error('  Source:', firstInvalid.source, '- exists?', newNodeIds.has(firstInvalid.source));
      console.error('  Target:', firstInvalid.target, '- exists?', newNodeIds.has(firstInvalid.target));
      console.error('  Type:', firstInvalid.type);
      
      // Filter out invalid links to prevent D3 crash
      console.warn(`Removing ${invalidLinks.length} invalid links to prevent crash`);
      const validLinks = newLinks.filter(l => 
        newNodeIds.has(l.source) && newNodeIds.has(l.target)
      );
      console.log(`Valid links remaining: ${validLinks.length} of ${newLinks.length}`);
      
      console.log(`Normalization complete: ${newNodes.length} nodes, ${validLinks.length} links (${invalidLinks.length} invalid links removed)`);
      return { nodes: newNodes, links: validLinks };
    }

    // Recompute degrees from new links
    const deg = new Map(newNodes.map(n => [n.id, 0]));
    newLinks.forEach(l => {
      deg.set(l.source, (deg.get(l.source) || 0) + 1);
      deg.set(l.target, (deg.get(l.target) || 0) + 1);
    });
    newNodes.forEach(n => n.degree = deg.get(n.id) || 0);

    console.log(`Normalization complete: ${newNodes.length} nodes, ${newLinks.length} links`);
    return { nodes: newNodes, links: newLinks };
  }

  // ---------------------------- Data Loading ----------------------------
  useEffect(() => {
    console.log(`Loading ${networkType} network...`);
    setLoading(true);
    setSelectedNode(null);
    const filename = networkType === 'sector' ? '/sector_network.json' : '/geo_network.json';
    
    fetch(filename)
      .then(r => {
        console.log(`Fetch response for ${filename}:`, r.status, r.ok);
        if (!r.ok) throw new Error(`HTTP ${r.status}: Failed to load ${filename}`);
        return r.json();
      })
      .then(raw => {
        console.log(`Raw ${networkType} data:`, raw);
        
        if (!raw || (!raw.nodes && !raw.links)) {
          throw new Error('Invalid network data structure');
        }
        
        const normalized = networkType === 'geo' ? normalizeGeo(raw) : raw;
        console.log(`Normalized ${networkType} data:`, normalized);
        
        // Ensure minimal shape
        const safe = {
          nodes: (normalized.nodes || []).map(n => ({ 
            id: n.id, 
            type: n.type || 'actor', 
            degree: n.degree ?? 0 
          })),
          links: (normalized.links || []).map(l => ({
            source: typeof l.source === 'object' ? l.source.id : l.source,
            target: typeof l.target === 'object' ? l.target.id : l.target,
            weight: l.weight ?? 1,
            type: l.type || ''
          }))
        };
        
        console.log(`✓ Loaded ${networkType} network:`, safe.nodes.length, 'nodes,', safe.links.length, 'links');
        
        if (safe.nodes.length === 0) {
          console.warn('Warning: No nodes in network data');
        }
        
        setData(safe);
        setLoading(false);
      })
      .catch(err => {
        console.error(`✗ Failed to load ${networkType} network:`, err);
        alert(`Failed to load ${networkType} network: ${err.message}\n\nCheck console for details.`);
        setLoading(false);
      });
  }, [networkType]);

  // ---------------------------- Live Search ----------------------------
  useEffect(() => {
    if (!data || !searchTerm) {
      setSearchResults([]);
      if (data) resetGraphStyles();
      return;
    }
    const term = searchTerm.toLowerCase();
    const results = data.nodes.filter(n => n.id.toLowerCase().includes(term)).slice(0, 12);
    setSearchResults(results);
    applyLiveSearch(term, results);
  }, [searchTerm, data]);

  const handleSearchSelect = (node) => {
    setSelectedNode(node);
    setSearchTerm('');
    setSearchResults([]);
    setTimeout(() => {
      if (simulationRef.current) {
        highlightConnections(node);
        zoomToNodes([node]);
      }
    }, 50);
  };

  // ---------------------------- Graph Interactions ----------------------------
  const highlightConnections = (sel) => {
    if (!data) return;
    const neighborIds = new Set();
    (data.links || []).forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === sel.id || t === sel.id) { 
        neighborIds.add(s); 
        neighborIds.add(t); 
      }
    });

    d3.select(svgRef.current).selectAll('.link')
      .transition().duration(220)
      .attr('stroke-opacity', l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (loading) return (
    <div className="loading">
      <div>LOADING {networkType.toUpperCase()} NETWORK…</div>
      <div style={{fontSize: '12px', marginTop: '8px', color: '#9AA8B7'}}>
        Check console if this takes too long
      </div>
    </div>
  );

  return (s === sel.id || t === sel.id) ? 0.85 : 0.05;
      })
      .attr('stroke-width', l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return (s === sel.id || t === sel.id) ? Math.sqrt(l.weight) * 2 : Math.sqrt(l.weight) * 0.3;
      });

    d3.select(svgRef.current).selectAll('.node')
      .transition().duration(220)
      .style('opacity', d => d.id === sel.id || neighborIds.has(d.id) ? 1 : 0.15);

    d3.select(svgRef.current).selectAll('.node-label')
      .transition().duration(220)
      .style('opacity', d => d.id === sel.id || neighborIds.has(d.id) ? 1 : 0.1);
  };

  const resetGraphStyles = () => {
    d3.select(svgRef.current).selectAll('.link')
      .transition().duration(200)
      .attr('stroke-opacity', 0.18)
      .attr('stroke-width', d => Math.sqrt(d.weight) * 0.55);
    d3.select(svgRef.current).selectAll('.node')
      .transition().duration(200)
      .style('opacity', 1);
    d3.select(svgRef.current).selectAll('.node-label')
      .transition().duration(200)
      .style('opacity', 1);
    if (svgSelRef.current && zoomRef.current) {
      svgSelRef.current.transition().duration(250).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  };

  const zoomToNodes = (nodes) => {
    if (!nodes || nodes.length === 0 || !svgSelRef.current || !gRef.current || !zoomRef.current) return;
    const padding = 100;
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = (window.innerWidth - 80);
    const height = (window.innerHeight - 220);
    const dx = Math.max(1, (maxX - minX));
    const dy = Math.max(1, (maxY - minY));
    const scale = Math.min(4, 0.9 / Math.max(dx / (width - padding*2), dy / (height - padding*2)));
    const tx = (width - scale * (minX + maxX)) / 2;
    const ty = (height - scale * (minY + maxY)) / 2;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svgSelRef.current.transition().duration(350).call(zoomRef.current.transform, transform);
  };

  const applyLiveSearch = (term, results) => {
    const matchIds = new Set(results.map(r => r.id));
    const neighborIds = new Set();
    (data.links || []).forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (matchIds.has(s) || matchIds.has(t)) { 
        neighborIds.add(s); 
        neighborIds.add(t); 
      }
    });
    const keep = new Set([...matchIds, ...neighborIds]);

    d3.select(svgRef.current).selectAll('.node')
      .transition().duration(150).style('opacity', d => keep.has(d.id) ? 1 : 0.12);
    d3.select(svgRef.current).selectAll('.node-label')
      .transition().duration(150).style('opacity', d => keep.has(d.id) ? 1 : 0.08);
    d3.select(svgRef.current).selectAll('.link')
      .transition().duration(150)
      .attr('stroke-opacity', l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return (keep.has(s) && keep.has(t)) ? 0.6 : 0.04;
      })
      .attr('stroke-width', l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return (keep.has(s) && keep.has(t)) ? Math.sqrt(l.weight) * 1.4 : Math.sqrt(l.weight) * 0.25;
      });

    const matchedNodeObjs = d3.select(svgRef.current).selectAll('.node').data().filter(n => matchIds.has(n.id));
    zoomToNodes(matchedNodeObjs);
  };

  // ---------------------------- D3 Graph Build ----------------------------
  useEffect(() => {
    if (!data || !svgRef.current) return;

    d3.select(svgRef.current).selectAll('*').remove();

    const width = window.innerWidth - 80;
    const height = window.innerHeight - 220;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);
    svgSelRef.current = svg;

    const g = svg.append('g');
    gRef.current = g;

    // Arrow marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-10 -10 20 20')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M-6,-6 L 0,0 L -6,6')
      .attr('fill', '#6F87A7')
      .attr('stroke', '#6F87A7')
      .attr('stroke-width', 1.2);

    const colorMap = { sponsor: '#E0555A', actor: '#6FA7FF', victim: '#3FB37D' };

    // Stronger separation to reduce hairball
    const simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.links).id(d => d.id).distance(110).strength(0.2))
      .force('charge', d3.forceManyBody().strength(-520))
      .force('center', d3.forceCenter(width/2, height/2))
      .force('collision', d3.forceCollide().radius(d => Math.sqrt(d.degree) * 4 + 12));

    simulationRef.current = simulation;

    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#6F87A7')
      .attr('stroke-opacity', 0.18)
      .attr('stroke-width', d => Math.sqrt(d.weight) * 0.55)
      .attr('marker-end', 'url(#arrowhead)');

    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(data.nodes)
      .join('circle')
      .attr('class', 'node')
      .attr('r', d => Math.sqrt(d.degree) * 4 + 6)
      .attr('fill', d => colorMap[d.type] || '#9AA8B7')
      .attr('stroke', '#0C1117')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('click', (event, d) => { setSelectedNode(d); highlightConnections(d); })
      .on('mouseover', function(event, d) {
        d3.select(this).transition().duration(160)
          .attr('stroke', '#96A6B8').attr('stroke-width', 3);
      })
      .on('mouseout', function(event, d) {
        d3.select(this).transition().duration(160)
          .attr('stroke', '#0C1117').attr('stroke-width', 2);
      });

    // Sparse labels for clarity
    const topNodes = [...data.nodes].sort((a,b) => b.degree - a.degree).slice(0, 16);
    const labels = g.append('g')
      .attr('class', 'labels')
      .selectAll('text')
      .data(topNodes)
      .join('text')
      .attr('class', 'node-label')
      .text(d => d.id.length > 28 ? d.id.slice(0, 28) + '…' : d.id)
      .attr('font-size', d => Math.min(13, Math.sqrt(d.degree) + 9))
      .attr('font-weight', 650)
      .attr('fill', '#D8E1EA')
      .attr('text-anchor', 'middle')
      .attr('dy', d => Math.sqrt(d.degree) * 4 + 24)
      .style('pointer-events', 'none');

    node.append('title').text(d => `${d.id}\nType: ${d.type}\nConnections: ${d.degree}`);

    node.call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

    const zoom = d3.zoom().scaleExtent([0.12, 4]).on('zoom', (ev) => { g.attr('transform', ev.transform); });
    zoomRef.current = zoom;
    svg.call(zoom);

    simulation.on('tick', () => {
      link.attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
      labels.attr('x', d => d.x).attr('y', d => d.y);
    });

    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x; 
      event.subject.fy = event.subject.y;
    }
    function dragged(event) { 
      event.subject.fx = event.x; 
      event.subject.fy = event.y; 
    }
    function dragended(event) { 
      if (!event.active) simulation.alphaTarget(0); 
      event.subject.fx = null; 
      event.subject.fy = null; 
    }

    return () => simulation.stop();
  }, [data]);

  return (
    <div className="network-container">
      <div className="header">
        <div className="header-top">
          <h1>CYBER ATTRIBUTION NETWORK</h1>
          <div className="header-subtitle">2000 — 2020</div>
          <div className="header-line"></div>
        </div>

        <div className="header-controls">
          <div className="search-container">
            <input
              type="text"
              placeholder="SEARCH ENTITIES…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { 
                  setSearchTerm(''); 
                  setSearchResults([]); 
                  resetGraphStyles(); 
                }
                if (e.key === 'Enter' && searchResults.length > 0) { 
                  handleSearchSelect(searchResults[0]); 
                }
              }}
              className="search-input"
            />
            {searchTerm && (
              <button 
                className="search-clear" 
                onClick={() => { 
                  setSearchTerm(''); 
                  setSearchResults([]); 
                  resetGraphStyles(); 
                }}
              >
                ×
              </button>
            )}
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map(node => (
                  <div 
                    key={node.id} 
                    className="search-result-item" 
                    onClick={() => handleSearchSelect(node)}
                  >
                    <span className={`result-dot ${node.type}`}></span>
                    <span className="result-name">{node.id}</span>
                    <span className="result-type">{node.type.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="controls">
            <button 
              className={networkType === 'sector' ? 'active' : ''} 
              onClick={() => { 
                setNetworkType('sector'); 
                setSelectedNode(null); 
              }}
            >
              SECTOR VIEW
            </button>
            <button 
              className={networkType === 'geo' ? 'active' : ''} 
              onClick={() => { 
                setNetworkType('geo'); 
                setSelectedNode(null); 
              }}
            >
              GEOGRAPHIC VIEW
            </button>
          </div>
        </div>
      </div>

      <div className="legend">
        <div className="legend-title">NODE TYPES</div>
        <div className="legend-item">
          <span className="dot sponsor"></span>
          <span>SPONSOR</span>
        </div>
        <div className="legend-item">
          <span className="dot actor"></span>
          <span>ACTOR</span>
        </div>
        <div className="legend-item">
          <span className="dot victim"></span>
          <span>TARGET</span>
        </div>
      </div>

      <svg ref={svgRef}></svg>

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => { 
            setSelectedNode(null); 
            resetGraphStyles(); 
          }}
        />
      )}

      <div className="instructions">
        CLICK NODE · DRAG TO REPOSITION · SCROLL TO ZOOM · SEARCH TO FILTER
      </div>
    </div>
  );
}