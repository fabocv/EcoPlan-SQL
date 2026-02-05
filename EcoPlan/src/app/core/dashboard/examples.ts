export interface ExamplePlan {
  title: string;
  content: string;
}
 
export const examplesExplain: ExamplePlan[] = [
    {
      title: 'Memory Killer (Multi-batch)',
      content: `Hash Join  (cost=5845.00..82145.22 rows=2000000 width=142) (actual time=45.120..980.432 rows=2000000 loops=1)
  Hash Cond: (orders.user_id = users.id)
  ->  Seq Scan on orders  (cost=0.00..32450.00 rows=2000000 width=120) (actual time=0.010..85.200 rows=2000000 loops=1)
  ->  Hash  (cost=4120.00..4120.00 rows=150000 width=22) (actual time=38.450..38.450 rows=150000 loops=1)
        Buckets: 4096  Batches: 256  Memory Usage: 88kB
        ->  Seq Scan on users  (cost=0.00..4120.00 rows=150000 width=22) (actual time=0.005..15.300 rows=150000 loops=1)`
    },
    {
      title: 'High Data Waste (Aguja en pajar)',
      content: `Limit  (cost=0.00..154.00 rows=1 width=8) (actual time=420.150..420.151 rows=1 loops=1)
  ->  Seq Scan on sensors  (cost=0.00..154000.00 rows=1000 width=8) (actual time=420.148..420.148 rows=1 loops=1)
        Filter: (status = 'critical'::text)
        Rows Removed by Filter: 4999999`
    },
    {
      title: 'Cartesian Nightmare (Caro)',
      content: `Nested Loop  (cost=0.00..8500450.00 rows=10000000 width=256) (actual time=0.850..15420.500 rows=10000000 loops=1)
  Join Filter: (sales.id > products.id)
  Rows Removed by Join Filter: 45000000
  ->  Seq Scan on sales  (cost=0.00..15500.00 rows=1000000 width=128) (actual time=0.010..245.300 rows=1000000 loops=1)
  ->  Materialize  (cost=0.00..1.50 rows=100 width=128) (actual time=0.001..0.005 rows=100 loops=1000000)
        ->  Seq Scan on products  (cost=0.00..1.20 rows=100 width=128) (actual time=0.002..0.008 rows=100 loops=1)`
    },
    {
      title: 'Deadly CTE Scan" (Recursión e I/O Masivo)',
      content: `CTE Scan on recursive_nodes  (cost=1250.45..550600.00 rows=1000000 width=512) (actual time=10.500..8900.250 rows=1000000 loops=1)
  CTE recursive_nodes
    ->  Recursive Union  (cost=0.00..1250.45 rows=1001 width=512) (actual time=0.020..8500.100 rows=1000000 loops=1)
          ->  Seq Scan on hierarchy_root  (cost=0.00..15.00 rows=1 width=512) (actual time=0.015..0.020 rows=1 loops=1)
          ->  Hash Join  (cost=0.45..123.54 rows=100 width=512) (actual time=0.500..820.400 rows=99999 loops=10)
                Hash Cond: (h.parent_id = r.id)
                ->  Seq Scan on heavy_hierarchy h  (cost=0.00..850.00 rows=50000 width=512) (actual time=0.010..45.200 rows=50000 loops=10)
                ->  Hash  (cost=0.20..0.20 rows=10 width=4) (actual time=0.050..0.050 rows=10 loops=1)
                      Buckets: 1024  Batches: 1  Memory Usage: 8kB
                      ->  WorkTable Scan on recursive_nodes r  (cost=0.00..0.20 rows=10 width=4) (actual time=0.001..0.005 rows=10 loops=1)
Planning Time: 0.890 ms
Execution Time: 9100.450 ms`
    },
    {
      title: 'Paralelismo y Worker Skew',
      content: `Gather  (cost=1000.00..156740.00 rows=50000 width=24) (actual time=1.500..120.450 rows=48000 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  ->  Parallel Seq Scan on log_entries  (cost=0.00..150740.00 rows=20833 width=24) (actual time=0.800..110.200 rows=24000 loops=3)
        Filter: (severity = 'ERROR'::text)
        Rows Removed by Filter: 850000
Planning Time: 0.120 ms
Execution Time: 125.600 ms`
    },
    {
      title: 'El "Bad Join" (Nested Loop sin Índice)',
      content: `Nested Loop  (cost=0.00..250450.12 rows=5000 width=48) (actual time=0.500..2850.320 rows=4500 loops=1)
  Join Filter: (p.category_id = c.id)
  Rows Removed by Join Filter: 1200000
  ->  Seq Scan on products p  (cost=0.00..450.00 rows=5000 width=32) (actual time=0.020..2.100 rows=5000 loops=1)
  ->  Materialize  (cost=0.00..1.50 rows=20 width=16) (actual time=0.001..0.250 rows=20 loops=5000)
        ->  Seq Scan on categories c  (cost=0.00..1.20 rows=20 width=16) (actual time=0.005..0.008 rows=20 loops=1)
Planning Time: 0.250 ms
Execution Time: 2855.800 ms`
    },
    {
      title: 'Desbordamiento en Sort (External Merge)',
      content: `Sort  (cost=145670.00..146820.00 rows=460000 width=512) (actual time=850.120..1150.450 rows=460000 loops=1)
  Sort Key: created_at DESC
  Sort Method: external merge  Disk: 54240kB
  ->  Seq Scan on audit_logs  (cost=0.00..45000.00 rows=460000 width=512) (actual time=0.010..180.500 rows=460000 loops=1)
Planning Time: 0.115 ms
Execution Time: 1210.340 ms`
    },
    {
      title: 'JIT & Parallel Heavy" (Uso masivo de Workers)',
      content: `Gather  (cost=5000.00..950000.00 rows=5000000 width=64) (actual time=150.000..4500.800 rows=5000000 loops=1)
  Workers Planned: 4
  Workers Launched: 4
  JIT:
    Functions: 12
    Options: Inlining true, Optimization true, Expressions true, Deforming true
    Timing: Generation 5.234 ms, Inlining 120.450 ms, Optimization 250.120 ms, Emission 180.450 ms, Total 556.254 ms
  ->  Parallel Seq Scan on big_telemetry  (cost=0.00..900000.00 rows=1250000 width=64) (actual time=2.100..4200.500 rows=1250000 loops=5)
        Filter: (metadata->>'type' = 'ERROR'::text)
        Rows Removed by Filter: 15000000
Planning Time: 1.250 ms
Execution Time: 4650.900 ms`
    },
    {
      title:"Vampiro de CPU",
      content:`
      Seq Scan on transactions t  (cost=0.00..500000.00 rows=100000 width=32) (actual time=0.010..500.000 rows=100000 loops=1)
  Filter: (t.amount > 1000)
  SubPlan 1
    ->  Index Scan using users_pk on users u  (cost=0.42..8.44 rows=1 width=32) (actual time=0.015..0.015 rows=1 loops=100000)
          Index Cond: (u.id = t.user_id)
Planning Time: 0.150 ms
Execution Time: 2000.500 ms`
    },
  ];