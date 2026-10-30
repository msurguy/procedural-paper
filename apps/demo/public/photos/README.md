# Photos

These photos are bundled as small, local derivatives of CC0 photographs from
[StockSnap.io](https://stocksnap.io/license). They were found through the
[Openverse](https://openverse.org) API (`license=cc0`).

| File | Original | Author |
| --- | --- | --- |
| avenue.webp | https://stocksnap.io/photo/city-street-LAVXQK6AUP | Lerone Pieters |
| beach.webp | https://stocksnap.io/photo/sea-beach-YR00YS2NSS | Mike Wilson |
| bike.webp | https://stocksnap.io/photo/bicycle-bike-Y2KCFMGHD1 | Alisa Anton |
| bookshelf.webp | https://stocksnap.io/photo/books-bookshelf-0SP70JWWOK | Startup Stock Photos |
| bread.webp | https://stocksnap.io/photo/bread-food-P7JB9GA027 | fireskystudios.com |
| cat.webp | https://stocksnap.io/photo/gray-cat-OU5O7ZUVH7 | Snapwire |
| coast.webp | https://stocksnap.io/photo/sea-beach-V9ITKZEU5H | Sergei Gussev |
| coffee.webp | https://stocksnap.io/photo/coffee-cup-0NEV1ZMLQO | Lia Leslie |
| dahlia.webp | https://stocksnap.io/photo/yellow-flower-GWT9JVALSV | Bernard Spragg |
| daisies.webp | https://stocksnap.io/photo/macro-flower-MLEZOMCWOW | Macro Mama |
| dock.webp | https://stocksnap.io/photo/mountains-lake-WPOWZBGDTU | Elliott Chau |
| drafting.webp | https://stocksnap.io/photo/office-work-42H3JH8QI5 | energepic.com |
| facade.webp | https://stocksnap.io/photo/bike-bicycle-J4D7AJ8YU0 | Huney Co |
| fog.webp | https://stocksnap.io/photo/forest-path-F5N87IRQO7 | Matt Bango |
| jump.webp | https://stocksnap.io/photo/sunset-silhouette-C3ZE3LVO34 | Joshua Earle |
| lake.webp | https://stocksnap.io/photo/mountains-lake-WL4Q1JLUDJ | Bonnie Moreland |
| letterpress.webp | https://stocksnap.io/photo/letterpress-paper-KM7BX1QANF | Birch Landing Home |
| pug.webp | https://stocksnap.io/photo/pug-dog-RM97YA77HX | Matthew Henry |
| reading.webp | https://stocksnap.io/photo/book-bookshelf-1XAJHYVE9L | Kristin Hardwick |
| skyline.webp | https://stocksnap.io/photo/architecture-buildings-UTLSND0DES | Kaique Rocha |
| sprout.webp | https://stocksnap.io/photo/minimal-office-CZWGWFXJYB | Altered Reality |
| street.webp | https://stocksnap.io/photo/city-streets-MSVLDUQDB6 | Jeffrey Betts |
| sunburst.webp | https://stocksnap.io/photo/sunset-sun-K4BK9Q3KL2 | Eric Haidara |
| window.webp | https://stocksnap.io/photo/banana-tree-WO21V5NTPY | Burst |

Source: StockSnap's 960 px preview JPEGs, downloaded October 12, 2026.
Each preview was scaled with `sips -Z 800` so its long edge is 800 px, then
encoded with `cwebp -q 80 -metadata none`. Colour grades (sepia, faded,
instant...) are applied at runtime in `src/photos.ts`, so the files stay neutral.
No external image service is called at runtime. A failed load falls back to a
procedural placeholder.
