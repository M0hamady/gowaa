# Cairo rail reference — source review

Reviewed: **6 November 2026**. Machine-readable reference: `public/data/rail-network.json`.

This reference supplies station names, the order of operating branches, interchange identities, and the published first/last terminal services. It supplies no live vehicle position, intermediate arrival prediction, fare, ticket inventory, or guaranteed connection. Coordinates belong in the separately sourced transport-map dataset.

## Sources and scope

| Dataset source ID | Primary source | What is used |
| --- | --- | --- |
| `winter-2026` | [State Information Service, Ministry of Transport winter timetable release](https://sis.gov.eg/ar/المركز-الإعلامي/الأخبار/وزارة-النقل-تعلن-مواعيد-تشغيل-خطوط-مترو-الأنفاق-الثلاثة-والقطار-الكهربائي-الخفيف-lrt-ومونوريل-شرق-النيل-تزامن-ا-مع-تطبيق-التوقيت-الشتوي/) | Direction-specific first/last terminal departures and last-train meetings. Published 28 October 2026; effective after midnight on Thursday 29 October, represented as 30 October. |
| `cairo-governorate-metro` | [Cairo Governorate metro guide](https://www.cairo.gov.eg/ar/governorate-services/transportation-services/metro/) | Ordered Line 1 and Line 2 stations. The guide's mention of a future Line 4 interchange is excluded. |
| `mobility-line3` | [RATP Dev Mobility Cairo, Green Line 3](https://www.mobilitycairo.com/ar/node/83) | Operating stations and the two branches west of Kit Kat. Area headings are not treated as additional stations. |
| `mobility-lrt` | [RATP Dev Mobility Cairo, LRT](https://www.mobilitycairo.com/ar/travel-information/lines/line-commuter-train-lrt) | The 12 operating stations, including the Badr branch towards Knowledge City. Future extensions are excluded. |
| `metro-important-stations` | [Cairo Metro, passenger landmarks](https://cairometro.gov.eg/ar/passengers/4) | Ramses national railway station beside El Shohadaa, and interchange context. No exit, platform or walking duration is inferred. |
| `mobility-projects` | [RATP Dev Mobility Cairo, operating projects](https://www.mobilitycairo.com/en/about-us/projects) | Independent operator count check: Line 3 has 34 stations; LRT has 12. |

The government timetable and Cairo Governorate guide were available as primary-source search extractions. Direct retrieval returned HTTP 502 during this review. Operator route pages were read through the web retrieval service. Publication dates are `null` where no date was stated; the review date is never presented as a publication date. Each dataset source also retains its retrieval reference for audit.

## Timetable interpretation

All clocks are Cairo time. `+1` means after midnight on the following calendar day. These are terminal reference times, not the next train at an intermediate station.

| Line / terminal direction | First | Last |
| --- | --- | --- |
| 1: Helwan ↔ New Marg | 05:15 | 23:40 |
| 2: Shubra → Moneeb | 05:15 | 23:55 |
| 2: Moneeb → Shubra | 05:15 | 00:05 +1 |
| 3: Adly → Cairo University | 05:15 | 23:33 |
| 3: Cairo University → Adly | 05:15 | 23:52 |
| 3: Adly → Rod corridor | 05:20 | 23:29 |
| 3: Rod corridor → Adly | 05:15 | 23:55 |
| LRT: Adly ↔ Arts/Culture | 06:00 | 23:20 |
| LRT: Badr → Adly | 06:01 | unspecified |
| LRT: Adly → Badr; Arts/Culture → Badr | unspecified | 23:40 |
| LRT: Badr → Knowledge | 06:25 | 23:30 |
| LRT: Knowledge → Badr | 06:38 | 23:47 |

The same release mentions Adly→Arts/Culture departures at 07:30 and 08:00. They are additional published departures, not a complete timetable or a claim of nonstop operation. Its last-train meetings are Sadat 00:25 +1, Nasser and Attaba 00:00 +1, and Cairo University 23:45. The 23:40 LRT services terminate at **Badr**.

No expiry date, complete weekday calendar, live disruption feed or headway is established by this release. `validUntil`, `weekdays`, `headwayMinutes` and intermediate arrival times therefore remain `null`. The consumer must label this as the published winter reference and avoid promising operation on a selected date or live transfer availability.

## Station graph

There are 95 unique station IDs. A shared interchange retains one ID across lines rather than two disconnected points.

| Line | Unique stations | Ordered branches |
| --- | ---: | --- |
| Metro 1 | 35 | Helwan → New Marg |
| Metro 2 | 20 | Shubra El Kheima → El Moneeb |
| Metro 3 | 34 | Adly Mansour → Kit Kat, then Rod El Farag Corridor or Cairo University |
| LRT | 12 | Adly Mansour → Badr → Arts/Culture; Badr → Industrial Zone → Knowledge City |

The six interchange IDs are `el-shohadaa`, `sadat`, `nasser`, `attaba`, `cairo-university` and `adly-mansour`. `lrt-badr` is an LRT branch junction; its presence does not promise that every train continues to either branch. Passengers must check the train's destination. English aliases aid matching; canonical Arabic names remain primary.

## Conflicts and exclusions

- Undated Cairo Metro operations pages show different terminal cutoffs and headways. Their old times do not override the later, dated government winter release. The consumer must not combine their headways with the winter first/last times to invent departures.
- The operator homepage surfaced Ramadan 2025 extended hours. Those seasonal hours are excluded from the November 2026 reference.
- An earlier government release from March 2026 contains different LRT values. The October winter release takes precedence for this snapshot.
- Line 4 and unoperated LRT extensions are excluded, even when a government project guide describes them. Monorail is outside this dataset's current scope.
- The Gate 1 general stand window of 06:00–14:00 and the owner-supplied Arts/Culture feeder notice of **07:00–14:00** describe road transport. Neither is the LRT train timetable. They remain in `transport-hubs.json` with their own provenance.
- A map pin identifies a reference location. It does not prove a boarding entrance, car drop-off, accessible walking route, or scheduled bus-to-metro connection.

## Consumer and review contract

Use `branches[].stationIds` for ordering, `interchanges` for confirmed rail transfers, and the exact service endpoints for first/last answers. A missing directional time stays unknown. Do not interpolate headways, duration, ticket availability, transfer slack or a boarding confirmation.

Before refreshing, compare source publication dates and applicable periods. Keep old published facts only when no newer applicable official source supersedes them. Add special-event changes explicitly; do not silently convert a winter reference into an all-year guarantee. Update `checkedAt` only after an actual review.

Structural verification checked unique IDs, complete source references, 35/20/34/12 station counts, six shared interchanges, 15 directional service entries, the after-midnight Moneeb cutoff, and the LRT distinction between Badr-terminating and end-to-end services. The final application remains responsible for rendering these limitations beside its answers.
