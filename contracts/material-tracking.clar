;; Material Tracking Contract
;; Tracks materials through their complete lifecycle from production to disposal

;; Constants
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-MATERIAL-NOT-FOUND (err u101))
(define-constant ERR-INVALID-INPUT (err u102))
(define-constant ERR-ALREADY-EXISTS (err u103))
(define-constant ERR-INVALID-STATUS (err u104))

;; Material status types
(define-constant STATUS-PRODUCED u1)
(define-constant STATUS-IN-USE u2)
(define-constant STATUS-COLLECTED u3)
(define-constant STATUS-RECYCLED u4)
(define-constant STATUS-DISPOSED u5)

;; Data Variables
(define-data-var next-material-id uint u1)
(define-data-var total-materials uint u0)

;; Data Maps
(define-map materials
  { material-id: uint }
  {
    creator: principal,
    current-owner: principal,
    material-type: (string-ascii 50),
    weight: uint,
    quality-score: uint,
    status: uint,
    created-at: uint,
    last-updated: uint,
    recycling-count: uint,
    carbon-footprint: uint
  }
)

(define-map material-history
  { material-id: uint, event-id: uint }
  {
    event-type: (string-ascii 20),
    from-owner: (optional principal),
    to-owner: principal,
    timestamp: uint,
    quality-change: int,
    notes: (string-ascii 200)
  }
)

(define-map material-event-count
  { material-id: uint }
  { count: uint }
)

(define-map owner-materials
  { owner: principal }
  { material-ids: (list 1000 uint) }
)

;; Read-only functions
(define-read-only (get-material (material-id uint))
  (map-get? materials { material-id: material-id })
)

(define-read-only (get-material-history (material-id uint) (event-id uint))
  (map-get? material-history { material-id: material-id, event-id: event-id })
)

(define-read-only (get-owner-materials (owner principal))
  (default-to
    { material-ids: (list) }
    (map-get? owner-materials { owner: owner })
  )
)

(define-read-only (get-total-materials)
  (var-get total-materials)
)

(define-read-only (get-next-material-id)
  (var-get next-material-id)
)

(define-read-only (get-material-event-count (material-id uint))
  (default-to
    { count: u0 }
    (map-get? material-event-count { material-id: material-id })
  )
)

;; Private functions
(define-private (add-material-to-owner (owner principal) (material-id uint))
  (let ((current-materials (get material-ids (get-owner-materials owner))))
    (map-set owner-materials
      { owner: owner }
      { material-ids: (unwrap-panic (as-max-len? (append current-materials material-id) u1000)) }
    )
  )
)

(define-private (remove-material-from-owner (owner principal) (material-id uint))
  (let ((current-materials (get material-ids (get-owner-materials owner))))
    (map-set owner-materials
      { owner: owner }
      { material-ids: (filter is-not-target-material current-materials) }
    )
  )
)

(define-private (is-not-target-material (id uint))
  (not (is-eq id (var-get next-material-id)))
)

(define-private (add-history-event
  (material-id uint)
  (event-type (string-ascii 20))
  (from-owner (optional principal))
  (to-owner principal)
  (quality-change int)
  (notes (string-ascii 200)))
  (let ((event-count (get count (get-material-event-count material-id))))
    (map-set material-history
      { material-id: material-id, event-id: event-count }
      {
        event-type: event-type,
        from-owner: from-owner,
        to-owner: to-owner,
        timestamp: block-height,
        quality-change: quality-change,
        notes: notes
      }
    )
    (map-set material-event-count
      { material-id: material-id }
      { count: (+ event-count u1) }
    )
  )
)

;; Public functions
(define-public (create-material
  (material-type (string-ascii 50))
  (weight uint)
  (initial-quality uint)
  (carbon-footprint uint))
  (let ((material-id (var-get next-material-id)))
    (asserts! (> weight u0) ERR-INVALID-INPUT)
    (asserts! (<= initial-quality u100) ERR-INVALID-INPUT)

    (map-set materials
      { material-id: material-id }
      {
        creator: tx-sender,
        current-owner: tx-sender,
        material-type: material-type,
        weight: weight,
        quality-score: initial-quality,
        status: STATUS-PRODUCED,
        created-at: block-height,
        last-updated: block-height,
        recycling-count: u0,
        carbon-footprint: carbon-footprint
      }
    )

    (add-material-to-owner tx-sender material-id)
    (add-history-event material-id "CREATED" none tx-sender 0 "Material created")

    (var-set next-material-id (+ material-id u1))
    (var-set total-materials (+ (var-get total-materials) u1))

    (ok material-id)
  )
)

(define-public (transfer-material (material-id uint) (new-owner principal))
  (let ((material (unwrap! (get-material material-id) ERR-MATERIAL-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get current-owner material)) ERR-NOT-AUTHORIZED)

    (map-set materials
      { material-id: material-id }
      (merge material {
        current-owner: new-owner,
        last-updated: block-height
      })
    )

    (remove-material-from-owner tx-sender material-id)
    (add-material-to-owner new-owner material-id)
    (add-history-event material-id "TRANSFER" (some tx-sender) new-owner 0 "Ownership transferred")

    (ok true)
  )
)

(define-public (update-material-status (material-id uint) (new-status uint))
  (let ((material (unwrap! (get-material material-id) ERR-MATERIAL-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get current-owner material)) ERR-NOT-AUTHORIZED)
    (asserts! (and (>= new-status u1) (<= new-status u5)) ERR-INVALID-STATUS)

    (map-set materials
      { material-id: material-id }
      (merge material {
        status: new-status,
        last-updated: block-height
      })
    )

    (add-history-event material-id "STATUS_UPDATE" none tx-sender 0 "Status updated")

    (ok true)
  )
)

(define-public (recycle-material (material-id uint) (quality-loss uint))
  (let ((material (unwrap! (get-material material-id) ERR-MATERIAL-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get current-owner material)) ERR-NOT-AUTHORIZED)
    (asserts! (<= quality-loss (get quality-score material)) ERR-INVALID-INPUT)

    (let ((new-quality (- (get quality-score material) quality-loss))
          (new-recycling-count (+ (get recycling-count material) u1)))

      (map-set materials
        { material-id: material-id }
        (merge material {
          quality-score: new-quality,
          status: STATUS-RECYCLED,
          recycling-count: new-recycling-count,
          last-updated: block-height
        })
      )

      (add-history-event material-id "RECYCLED" none tx-sender (- 0 (to-int quality-loss)) "Material recycled")

      (ok new-quality)
    )
  )
)

(define-public (dispose-material (material-id uint))
  (let ((material (unwrap! (get-material material-id) ERR-MATERIAL-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get current-owner material)) ERR-NOT-AUTHORIZED)

    (map-set materials
      { material-id: material-id }
      (merge material {
        status: STATUS-DISPOSED,
        last-updated: block-height
      })
    )

    (add-history-event material-id "DISPOSED" none tx-sender 0 "Material disposed")

    (ok true)
  )
)
