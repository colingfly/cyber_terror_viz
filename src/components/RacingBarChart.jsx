import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function RacingBarChart() {
  const svgRef = useRef();
  const [data, setData] = useState(null);
  const [currentYear, setCurrentYear] = useState(2005);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    fetch('/sponsor_timeline.json')
      .then(res => res.json())
      .then(timelineData => {
        setData(timelineData);
      })
      .catch(err => console.error('Error loading timeline:', err));
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const margin = { top: 100, right: 150, bottom: 80, left: 250 };
    const width = 1100 - margin.left - margin.right;
    const height = 650 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const yearData = data
      .filter(d => d.year === currentYear)
      .sort((a, b) => b.cumulative - a.cumulative)
      .slice(0, 10);

    const x = d3.scaleLinear()
      .domain([0, d3.max(yearData, d => d.cumulative) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(yearData.map(d => d.sponsor))
      .range([0, height])
      .padding(0.15);

    const colorScale = d3.scaleOrdinal()
      .domain(['China', 'Russian Federation', 'Iran (Islamic Republic of)', 
               'Korea (Democratic People\'s Republic of)'])
      .range(['#3b82f6', '#ef4444', '#10b981', '#f59e0b']);

    // Add grid lines
    svg.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(x.ticks(5))
      .join('line')
      .attr('x1', d => x(d))
      .attr('x2', d => x(d))
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    // Draw bars with smooth transitions
    svg.selectAll('.bar')
      .data(yearData, d => d.sponsor)
      .join(
        enter => enter.append('rect')
          .attr('class', 'bar')
          .attr('x', 0)
          .attr('y', d => y(d.sponsor))
          .attr('width', 0)
          .attr('height', y.bandwidth())
          .attr('fill', d => colorScale(d.sponsor) || '#64748b')
          .attr('rx', 4)
          .call(enter => enter.transition()
            .duration(1200)
            .ease(d3.easeCubicInOut)
            .attr('width', d => x(d.cumulative))),
        update => update.call(update => update.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .attr('y', d => y(d.sponsor))
          .attr('width', d => x(d.cumulative))),
        exit => exit.call(exit => exit.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .attr('width', 0)
          .remove())
      );

    // Add sponsor labels
    svg.selectAll('.label')
      .data(yearData, d => d.sponsor)
      .join(
        enter => enter.append('text')
          .attr('class', 'label')
          .attr('x', -10)
          .attr('y', d => y(d.sponsor) + y.bandwidth() / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .text(d => d.sponsor.length > 35 ? d.sponsor.substring(0, 35) + '...' : d.sponsor)
          .style('font-size', '13px')
          .style('fill', '#cbd5e1')
          .style('font-weight', '600')
          .style('font-family', 'monospace')
          .style('opacity', 0)
          .call(enter => enter.transition()
            .duration(1200)
            .ease(d3.easeCubicInOut)
            .style('opacity', 1)),
        update => update.call(update => update.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .attr('y', d => y(d.sponsor) + y.bandwidth() / 2)),
        exit => exit.call(exit => exit.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .style('opacity', 0)
          .remove())
      );

    // Add value labels
    svg.selectAll('.value')
      .data(yearData, d => d.sponsor)
      .join(
        enter => enter.append('text')
          .attr('class', 'value')
          .attr('x', d => x(d.cumulative) + 10)
          .attr('y', d => y(d.sponsor) + y.bandwidth() / 2)
          .attr('dy', '0.35em')
          .text(d => d.cumulative)
          .style('font-size', '14px')
          .style('fill', '#f1f5f9')
          .style('font-weight', '700')
          .style('font-family', 'monospace')
          .style('opacity', 0)
          .call(enter => enter.transition()
            .duration(1200)
            .ease(d3.easeCubicInOut)
            .style('opacity', 1)),
        update => update.call(update => update.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .attr('x', d => x(d.cumulative) + 10)
          .attr('y', d => y(d.sponsor) + y.bandwidth() / 2)
          .tween('text', function(d) {
            const i = d3.interpolateNumber(+this.textContent, d.cumulative);
            return function(t) {
              this.textContent = Math.round(i(t));
            };
          })),
        exit => exit.call(exit => exit.transition()
          .duration(1200)
          .ease(d3.easeCubicInOut)
          .style('opacity', 0)
          .remove())
      );

    // Add year label
    svg.append('text')
      .attr('class', 'year-label')
      .attr('x', width - 10)
      .attr('y', -50)
      .attr('text-anchor', 'end')
      .text(currentYear)
      .style('font-size', '64px')
      .style('font-weight', '800')
      .style('font-family', 'monospace')
      .style('fill', '#1e293b')
      .style('stroke', '#3b82f6')
      .style('stroke-width', '2px')
      .style('opacity', 0.4);

  }, [data, currentYear]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentYear(prev => {
        if (prev >= 2025) {
          setIsPlaying(false);
          return 2005;
        }
        return prev + 1;
      });
    }, 1800); // Increased from 800ms to 1800ms

    return () => clearInterval(interval);
  }, [isPlaying]);

  if (!data) return <div className="loading">Loading timeline...</div>;

  return (
    <div className="racing-container">
      <div className="racing-header">
        <div className="header-line"></div>
        <h1>STATE-SPONSORED CYBER INCIDENTS</h1>
        <p className="subtitle">CUMULATIVE ATTRIBUTION TIMELINE · 2005-2025</p>
        <div className="header-line"></div>
      </div>

      <div className="racing-controls">
        <button className="control-btn" onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
        </button>
        <div className="slider-container">
          <input
            type="range"
            min="2005"
            max="2025"
            value={currentYear}
            onChange={(e) => {
              setCurrentYear(parseInt(e.target.value));
              setIsPlaying(false);
            }}
            className="year-slider"
          />
          <div className="slider-track"></div>
        </div>
        <span className="year-display">{currentYear}</span>
      </div>

      <svg ref={svgRef}></svg>
    </div>
  );
}