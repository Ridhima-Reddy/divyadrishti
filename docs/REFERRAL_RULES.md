# Referral rules: what is a red flag, and what is not

Generated from `web/js/engine/redflags.js` (rules 2026.11-r3) by `node tools/rules_table.mjs`. The app, the portal and this page show the same table.

**Principle:** only the findings in the Emergency table send a patient to hospital today. Every other finding gets the slowest time-to-care that is still safe, so long-standing floaters, slow blur, itchy eyes or a family history do not trigger a same-day referral. Each red-flag question asks about one symptom that is NEW or SUDDEN, and follow-up questions (when did it start, is there a curtain, does it go away with one eye covered, what kind of injury) decide the tier.

| Tier | Time to care | Lane | Hub reviews within |
|---|---|---|---|
| Emergency | same day | red | 2 h |
| Urgent | 18 hours to 2 weeks (each rule states it) | amber | 24 h |
| Soon | 2 to 6 weeks | amber | 72 h |
| Routine | next camp or within 3 months | green | 72 h |
| Note | no referral | green | 72 h |

Tiers follow the College of Optometrists referral categories (emergency / urgent / routine) and use NICE time limits where NICE sets one (wet AMD: 1 working day; absent red reflex: 2 weeks).

## Emergency: same day

| Finding | Scores when | Time to care | Action | Evidence |
|---|---|---|---|---|
| **Chemical in the eye** `CHEMICAL_INJURY` | Injury type: chemical (lime/chuna, acid, cleaning liquid, battery fluid, Holi colour) | now, then same day | Rinse with clean running water for at least 15 minutes NOW, then eye casualty today. Do not wait for the review. | [cop_cmg](#ref-cop_cmg) |
| **High-speed or sharp object injury** `PENETRATING_INJURY` | Injury type: chip from hammering, grinding or drilling, or a sharp object | same day | Do not press or rub. Tape a paper cup over the eye. Eye casualty today; a metal chip can be inside the eye with little pain. | [cop_annex4](#ref-cop_annex4) |
| **Blow to the eye with reduced vision** `BLUNT_INJURY_VISION` | Injury type: a hit (ball, fist, stick) AND sight has dropped or is blurred | same day | Eye casualty today (bleeding inside the eye or a ruptured globe must be ruled out). | [cop_annex4](#ref-cop_annex4) |
| **Possible retinal detachment** `RETINAL_DETACHMENT_SIGNS` | A shadow or curtain that does not go away, OR new flashes/floaters together with a sudden drop in sight | same day | Eye hospital today. Avoid heavy lifting on the way. | [cop_flashes](#ref-cop_flashes) |
| **Sudden loss of vision in the last 2 days** `SUDDEN_LOSS_RECENT` | Sight dropped suddenly (minutes to days, not months) AND it started today or yesterday. If the start was not recorded it is treated as recent. | same day | Eye hospital today: a blocked blood vessel, detachment or optic-nerve problem is time-critical. | [cop_annex4](#ref-cop_annex4) |
| **Possible acute angle-closure glaucoma** `ANGLE_CLOSURE_SIGNS` | Red eye with real pain AND either coloured rings around lights, or headache/vomiting together with blurred sight | same day | Eye hospital today: pressure inside the eye can blind within hours. No eye drops from the shop. | [cop_annex4](#ref-cop_annex4) |
| **Contact-lens wearer with a painful or blurred red eye** `CONTACT_LENS_KERATITIS` | Wears contact lenses AND red eye with pain, light sensitivity or blur | same day | Remove the lenses, keep them and the case for the doctor, eye hospital today (possible corneal infection). | [cop_keratitis](#ref-cop_keratitis) |
| **New double vision with neurological signs** `DIPLOPIA_NEURO` | New double vision that is not monocular (does not stay with one eye covered) AND new severe headache, droopy eyelid, weakness, numbness or trouble speaking | same day | Hospital emergency today (possible aneurysm or stroke). Do not let the patient drive. | [neuro_diplopia](#ref-neuro_diplopia) |
| **Squint in a child with headache, vomiting or unsteadiness** `CHILD_SQUINT_NEURO` | Child with a squint AND headaches, vomiting or unsteady walking | same day | Children’s hospital emergency today (raised pressure in the head must be ruled out). | [nice_ng127](#ref-nice_ng127) |
| **White pupil glow with a squint in a child** `LEUKOCORIA_WITH_SQUINT` | Child with a white glow in the pupil AND a squint | same day | Paediatric ophthalmology today or as an immediate referral. | [nice_ng127](#ref-nice_ng127) |

## Urgent: 18 hours to 2 weeks (each rule states it)

| Finding | Scores when | Time to care | Action | Evidence |
|---|---|---|---|---|
| **Scratch on the eye (leaf, crop, branch, nail, dust)** `CORNEAL_SCRATCH` | Injury type: scratch, and no chemical or sharp-object injury | within 18 hours | Antibiotic eye ointment within 18 hours from the vision centre or PHC. No steroid drops, no home remedies (risk of a fungal ulcer after crop injuries). | [bhaktapur](#ref-bhaktapur), [madurai](#ref-madurai) |
| **Blow to the eye, vision normal** `BLUNT_INJURY` | Injury type: a hit, and sight has not dropped | within 24 hours | Optometrist or eye doctor within 24 hours; same day if vision drops, pain grows or a red level appears in the eye. | [cop_annex4](#ref-cop_annex4) |
| **New flashes or floaters, no curtain, sight unchanged** `FLASHES_FLOATERS` | NEW flashes or a shower of new floaters in the last few weeks, no curtain, no sudden drop in sight | within 24 hours | Dilated retina examination within 24 hours. Go the same day if a curtain appears or sight drops. | [cop_flashes](#ref-cop_flashes), [pvd_pathway](#ref-pvd_pathway) |
| **Sudden drop in sight 3 to 14 days ago** `SUDDEN_LOSS_SUBACUTE` | Sight dropped suddenly AND it started 3 to 14 days ago | within 48 hours | Eye doctor within 24-48 hours. | [cop_annex4](#ref-cop_annex4) |
| **New double vision (both eyes), no neurological signs** `DIPLOPIA_NEW` | New double vision that goes away when either eye is covered (or not sure), and no headache, droopy lid, weakness or speech problem | within 48 hours | Eye doctor within 24-48 hours; check blood pressure and sugar (nerve palsies are common in diabetes). Same day if a headache or droopy lid starts. No driving meanwhile. | [neuro_diplopia](#ref-neuro_diplopia) |
| **Painful red eye with blurred sight** `PAINFUL_RED_EYE_BLUR` | Red eye with pain or light sensitivity AND blurred sight (no haloes or vomiting, no contact lenses) | within 24 hours | Eye doctor within 24 hours (keratitis or iritis). No steroid drops from the shop. | [cop_keratitis](#ref-cop_keratitis) |
| **Painful red eye, sight normal** `PAINFUL_RED_EYE` | Red eye with real pain or light sensitivity, sight not blurred | within 48 hours | Optometrist or eye doctor within 48 hours; sooner if sight blurs. | [cop_annex4](#ref-cop_annex4) |
| **New distortion on the Amsler grid** `MACULA_NEW` | Wavy, broken or missing lines AND new (or not sure, age 50+) | within 1 working day | Macula assessment (OCT or retinal exam) within 1 working day; wet AMD treatment works best early. | [nice_ng82](#ref-nice_ng82) |
| **White pupil glow in a child** `LEUKOCORIA` | Child with a white glow in the pupil (seen in person or in a photo), no squint | within 2 weeks | Paediatric ophthalmology within 2 weeks (childhood cataract or retinoblastoma). Phone the hospital to confirm the date. | [nice_ng12](#ref-nice_ng12) |

## Soon: 2 to 6 weeks

| Finding | Scores when | Time to care | Action | Evidence |
|---|---|---|---|---|
| **Sudden drop in sight more than 2 weeks ago** `SUDDEN_LOSS_OLD` | Sight dropped suddenly AND it started more than 2 weeks ago | within 2 weeks | Full eye examination within 1-2 weeks (old vein occlusion, bleed or macular problem). | [cop_annex4](#ref-cop_annex4) |
| **Squint or head tilt in a child** `CHILD_SQUINT` | Child whose eye turns in or out, or who tilts the head or closes one eye, with no headache, vomiting or white glow | within 6 weeks | Paediatric optometrist or ophthalmologist within 4-6 weeks: lazy eye responds best when treated young. | [nice_ng127](#ref-nice_ng127), [amblyopia](#ref-amblyopia) |
| **Child likely needs glasses** `CHILD_REFRACTION` | Child with trouble seeing the school board, or vision worse than 6/9 in either eye | within 6 weeks | Cycloplegic refraction (with drops) by an optometrist; phone estimates are not safe for children. | [amblyopia](#ref-amblyopia) |
| **Vision worse than 6/60 in an eye** `SEVERE_VI` | Best phone-measured vision (with pinhole) worse than 6/60 in either eye | within 4 weeks | Full eye examination within 2-4 weeks; most often cataract in this age group. | [who_vi](#ref-who_vi) |
| **Possible cataract affecting vision** `CATARACT_OPERABLE` | Age 50+, no cataract surgery, a cataract sign (night glare, power changing, pinhole fails, low contrast) AND best vision 6/18 or worse | within 6 weeks | Cataract assessment at the next camp or vision centre; surgery restores sight better than new glasses. | [who_vi](#ref-who_vi) |
| **Reduced vision not explained by glasses** `VA_UNEXPLAINED` | Vision 6/18 or worse that a pinhole does not improve, and no cataract signs at 50+ | within 4 weeks | Optometrist or ophthalmologist examination within 4 weeks. | [pinhole](#ref-pinhole) |
| **Long-standing distortion on the Amsler grid** `MACULA_OLD` | Wavy, broken or missing lines that the patient says have been there a long time (or not sure, under 50) | within 4 weeks | Retina examination within 2-4 weeks; urgent if it changes. | [nice_ng82](#ref-nice_ng82) |
| **Diabetes, retina never checked, 5+ years** `DIABETES_RETINA_OVERDUE` | Diabetes AND never had a dilated retina check AND diabetes for 5 years or more (or vision 6/12 or worse) | within 6 weeks | Dilated retina examination or retinal photo within 4-6 weeks. | [ico_dr](#ref-ico_dr) |
| **Markedly reduced contrast sensitivity** `CONTRAST_MARKED` | Contrast below 1.0 log CS in an eye, not already explained by a cataract finding | within 4 weeks | Full eye examination within 4 weeks (cataract, glaucoma, optic nerve or retina). | [pelli](#ref-pelli) |
| **Large difference between the eyes in a child** `CHILD_ANISOMETROPIA` | Child AND 2.00 D or more difference in spherical equivalent between the eyes | within 6 weeks | Optometrist within 4-6 weeks: amblyopia check. | [refraction](#ref-refraction) |

## Routine: next camp or within 3 months

| Finding | Scores when | Time to care | Action | Evidence |
|---|---|---|---|---|
| **Early cataract signs, vision still useful** `CATARACT_EARLY` | Age 50+, a cataract sign, best vision better than 6/18 | next camp | Cataract check at the next camp; glasses can still help now. | [who_vi](#ref-who_vi) |
| **Diabetic retina check due** `DIABETES_RETINA_DUE` | Diabetes AND last dilated retina check more than a year ago (or never, under 5 years) | next camp | Yearly dilated retina check or retinal photo at the next camp or vision centre. | [ico_dr](#ref-ico_dr) |
| **Glaucoma in a parent, brother or sister, age 40+** `GLAUCOMA_FAMILY` | First-degree relative with glaucoma AND age 40 or over | next camp | Eye pressure and optic-nerve check at the next camp or vision centre. | [ico_glaucoma](#ref-ico_glaucoma) |
| **Glasses power changing often** `UNSTABLE_POWER` | Needed new glasses more than once in 2 years, no cataract finding | before the next prescription | Check sugar control and keratoconus before a new prescription. | [cop_cmg](#ref-cop_cmg) |
| **Reduced contrast sensitivity** `CONTRAST_REDUCED` | Contrast 1.0-1.35 log CS in an eye, not explained by a cataract finding | next camp | Full eye examination at the next visit. | [pelli](#ref-pelli) |
| **Eyes do not team well up close (receded convergence)** `CONVERGENCE_RECEDED` | Near point of convergence beyond 6 cm (under 40) or 10 cm (40+) | next visit | Binocular vision assessment; eye exercises often help. Explains strain with close work. | [npc](#ref-npc) |
| **Double vision in one eye only** `MONOCULAR_DIPLOPIA` | Double vision that stays when the other eye is covered | next visit | Optometrist: usually cataract, astigmatism or dry eye, not a nerve problem. | [neuro_diplopia](#ref-neuro_diplopia) |
| **Red eye without pain or blur** `RED_EYE_MILD` | Red eye with only itching, sticky discharge or nothing else; no pain, light sensitivity, blur or contact lenses | if not better in 7 days | Usually conjunctivitis or dry eye: wash hands, do not share towels. Optometrist if not better in 7 days; same day if pain or blur starts. | [cop_cmg](#ref-cop_cmg) |
| **Discomfort with current progressives** `PROGRESSIVE_INTOLERANCE` | Wears progressives AND reports headaches or discomfort | at dispensing | Check centration (PD, fitting height) before changing the lens. | [cop_cmg](#ref-cop_cmg) |
| **Large difference between the eyes** `ANISOMETROPIA` | Adult with 2.00 D or more difference in spherical equivalent | next visit | Optometrist review of the prescription and lens choice. | [refraction](#ref-refraction) |
| **High myopia** `HIGH_MYOPIA` | Spherical equivalent -6.00 D or more | yearly | Yearly retina check (higher risk of detachment and glaucoma); explain flashes/curtain warning signs. | [refraction](#ref-refraction) |
| **High hyperopia** `HIGH_HYPEROPIA` | Spherical equivalent +5.00 D or more | next visit | Optometrist review (narrow-angle risk in adults, amblyopia risk in children). | [refraction](#ref-refraction) |
| **High astigmatism** `HIGH_ASTIGMATISM` | Cylinder 3.00 D or more | next visit | Optometrist review; corneal topography if available (keratoconus). | [refraction](#ref-refraction) |

## Note: no referral

| Finding | Scores when | Time to care | Action | Evidence |
|---|---|---|---|---|
| **Possible red-green colour vision difference** `COLOUR_VISION` | 2 or more number plates misread on the colour test | no referral | Usually inherited and harmless; tell the patient (driving, electrical and some jobs). Refer only if it is new or in one eye. | [cop_cmg](#ref-cop_cmg) |

## Not a red flag

| Presentation | Why it is not flagged |
|---|---|
| Floaters that have been there for months or years and have not changed | Old, stable floaters are usually harmless vitreous changes; only NEW flashes or a shower of NEW floaters are flagged. |
| Blur that came on slowly over months | Gradual blur is glasses or cataract: handled by the vision tests and routine referral, not as an emergency. |
| Itchy, watery, gritty or burning eyes without pain or blur | Allergy, dry eye or mild conjunctivitis: advice, and an optometrist only if not better in a week. |
| A squint in an adult that has been there since childhood | Long-standing, not new; recorded for the optometrist. |
| Headache or tired eyes after long close or screen work, sight otherwise normal | Usually an uncorrected near or intermediate power: fixed by the right glasses and breaks. |
| Haloes around lights at night without pain or redness | Usually cataract or uncorrected power: routine, unless the eye is red and painful. |
| Known cataract with slowly falling vision | Routine or soon cataract referral depending on vision, not same-day. |
| Colour vision difference since birth | Inherited and stable: information for the patient, not a referral. |

## Fail-safes

- If the patient says their sight dropped suddenly but the onset question is skipped, the final triage treats it as recent (emergency).
- A spoken "yes" to any red-flag question must be confirmed by a tap before it counts.
- An emergency finding shortens the interview to the essential questions; urgent and lower findings do not.
- The reviewing optometrist can always escalate or downgrade; every rule is a proposal to be agreed with them before the pilot.

## References

- <a id="ref-cop_annex4"></a>**cop_annex4** (guideline): College of Optometrists, Guidance for Professional Practice, Annex 4: urgency of referrals. https://www.college-optometrists.org/clinical-guidance/guidance/guidance-annexes/annex-4-urgency-of-referrals-table
- <a id="ref-cop_cmg"></a>**cop_cmg** (guideline): College of Optometrists, Clinical Management Guidelines (categories A1 emergency, A3 urgent within 1 week, B1 routine). https://www.college-optometrists.org/guidance/clinical-management-guidelines/what-are-clinical-management-guidelines.html
- <a id="ref-cop_flashes"></a>**cop_flashes** (guideline): College of Optometrists, Examining patients who present with flashes and floaters (emergency if detachment, haemorrhage or symptomatic break; otherwise dilated examination). https://www.college-optometrists.org/Clinical-guidance/Guidance/Knowledge,-skills-and-performance/Examining-patients-who-present-with-flashes-and-fl
- <a id="ref-pvd_pathway"></a>**pvd_pathway** (local pathway): NHS flashes and floaters pathway (James Paget University Hospitals, 2025): dilated assessment within 24 h; 10-15% of acute PVDs have a retinal tear (WikEM). https://www.jpaget.nhs.uk/media/tabnvp1f/flashes-and-floaters-jan-2025.pdf
- <a id="ref-cop_keratitis"></a>**cop_keratitis** (guideline): College of Optometrists CMG: Microbial keratitis, A1 emergency (same day) if fungal or sight-threatening bacterial keratitis is suspected. https://www.college-optometrists.org/clinical-guidance/clinical-management-guidelines/microbialkeratitis_bacterial_fungal
- <a id="ref-bhaktapur"></a>**bhaktapur** (trial): Upadhyay et al., Bhaktapur Eye Study, Br J Ophthalmol 2001: no ulcers when antibiotic ointment started within 18 h of a corneal abrasion. https://pubmed.ncbi.nlm.nih.gov/?term=Bhaktapur+eye+study+corneal+ulceration+antibiotic+prophylaxis
- <a id="ref-madurai"></a>**madurai** (study): Srinivasan et al., corneal ulceration in Madurai, south India, Br J Ophthalmol 1997;81:965-71: mostly after agricultural injury, often fungal. https://pubmed.ncbi.nlm.nih.gov/?term=Srinivasan+1997+corneal+ulceration+Madurai
- <a id="ref-nice_ng82"></a>**nice_ng82** (guideline): NICE NG82 (AMD) 1.2: refer suspected wet active AMD urgently to a macula service, normally within 1 working day; not an emergency. https://www.nice.org.uk/guidance/ng82/chapter/recommendations
- <a id="ref-nice_ng12"></a>**nice_ng12** (guideline): NICE NG12 (suspected cancer) 1.12.2: urgent referral (appointment within 2 weeks) for a child with an absent red reflex. https://www.nice.org.uk/guidance/ng12
- <a id="ref-nice_ng127"></a>**nice_ng127** (guideline): NICE NG127 (suspected neurological conditions): new squint with loss of red reflex, or with headache, vomiting or unsteadiness, refer immediately; other squints to ophthalmology. https://www.nice.org.uk/guidance/ng127
- <a id="ref-neuro_diplopia"></a>**neuro_diplopia** (clinical consensus): Neuro-ophthalmology teaching (e.g. EyeWiki, third nerve palsy): new double vision with headache, a droopy lid or other neurological signs can be an aneurysm or stroke. https://eyewiki.org/index.php?search=third+nerve+palsy
- <a id="ref-who_vi"></a>**who_vi** (classification): WHO / ICD-11 visual impairment categories: moderate worse than 6/18, severe worse than 6/60. https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment
- <a id="ref-pinhole"></a>**pinhole** (clinical consensus): Pinhole test: reduced vision that a pinhole does not improve points to disease, not refractive error. https://eyewiki.org/index.php?search=pinhole+visual+acuity
- <a id="ref-ico_dr"></a>**ico_dr** (guideline): ICO Guidelines for Diabetic Eye Care (2017): retinal examination at diagnosis of type 2 diabetes, then every year. https://icoph.org/?s=diabetic+eye+care+guidelines
- <a id="ref-ico_glaucoma"></a>**ico_glaucoma** (guideline): ICO Guidelines for Glaucoma Eye Care (2016): first-degree relatives are at higher risk; examine from 40. https://icoph.org/?s=glaucoma+eye+care+guidelines
- <a id="ref-amblyopia"></a>**amblyopia** (clinical consensus): Amblyopia responds best to treatment in early childhood (PEDIG studies; NICE CKS amblyopia). https://eyewiki.org/index.php?search=amblyopia
- <a id="ref-npc"></a>**npc** (clinical consensus): Convergence insufficiency: near point of convergence break beyond 6 cm (under 40) or 10 cm (40 and over) is receded (EyeWiki; CITT used 6 cm). https://eyewiki.org/Convergence_Insufficiency
- <a id="ref-pelli"></a>**pelli** (study): Pelli-Robson norms: about 1.65-1.95 log CS in healthy adults; below 1.5 is reduced (Mantyjarvi & Laitinen, J Cataract Refract Surg 2001). https://pubmed.ncbi.nlm.nih.gov/?term=Mantyjarvi+Laitinen+normal+values+Pelli-Robson
- <a id="ref-refraction"></a>**refraction** (clinical consensus): High refractive error and anisometropia: annual review; amblyopia risk in children. https://eyewiki.org/index.php?search=anisometropia
